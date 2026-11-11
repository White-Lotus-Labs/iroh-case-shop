import CryptoKit
import Foundation
import Security

func stop(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func base58(_ bytes: Data) -> String {
    let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    var digits: [Int] = []
    for byte in bytes {
        var carry = Int(byte)
        for index in digits.indices {
            carry += digits[index] * 256
            digits[index] = carry % 58
            carry /= 58
        }
        while carry > 0 {
            digits.append(carry % 58)
            carry /= 58
        }
    }
    return String(repeating: "1", count: bytes.prefix(while: { $0 == 0 }).count)
        + String(digits.reversed().map { alphabet[$0] })
}

func validPublicKey(_ value: String) -> Bool {
    guard value.hasPrefix("ed25519:") else { return false }
    let encoded = String(value.dropFirst("ed25519:".count))
    guard (43...44).contains(encoded.count) else { return false }
    let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    var decoded: [Int] = []
    for character in encoded {
        guard let digit = alphabet.firstIndex(of: character) else { return false }
        var carry = digit
        for index in decoded.indices.reversed() {
            carry += decoded[index] * 58
            decoded[index] = carry & 255
            carry >>= 8
        }
        while carry > 0 {
            decoded.insert(carry & 255, at: 0)
            carry >>= 8
        }
    }
    return decoded.count + encoded.prefix(while: { $0 == "1" }).count == 32
}

struct TokenEntry: Decodable {
    let asset: String
    let contractId: String?
    let selection: String
}
struct TokenRegistry: Decodable {
    let network: String
    let tokens: [TokenEntry]
}
struct CaseEntry: Decodable {
    let id: String
    let contractId: String
}
struct CaseRegistry: Decodable {
    let network: String
    let cases: [CaseEntry]
}
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
guard let tokenBytes = try? Data(contentsOf: root.appendingPathComponent("config/tokens.testnet.json")),
      let caseBytes = try? Data(contentsOf: root.appendingPathComponent("config/cases.testnet.json")),
      let tokens = try? JSONDecoder().decode(TokenRegistry.self, from: tokenBytes),
      let cases = try? JSONDecoder().decode(CaseRegistry.self, from: caseBytes),
      tokens.network == "testnet", cases.network == "testnet" else {
    stop("Could not read the approved Testnet registries.")
}
let approvedAssets = Set(["BLACKDRAGON", "NEKO", "MPDAO", "GEAR", "PURGE", "WNEAR", "STNEAR", "LINEAR", "RNEAR"])
let approvedCases = Set(["bamboo-mist", "moon-spirit", "phoenix-flame", "uncles-secret-reserve"])
var authorized: [String: String] = [:]
for token in tokens.tokens where token.selection == "included" && approvedAssets.contains(token.asset) {
    guard let account = token.contractId,
          account == token.asset.lowercased() + ".needmore_1_near.testnet" else {
        stop("Token registry has an unexpected account.")
    }
    authorized[account] = token.asset
}
for teaCase in cases.cases where approvedCases.contains(teaCase.id) {
    guard teaCase.contractId.hasSuffix(".needmore_1_near.testnet") else {
        stop("Case registry has an unexpected account.")
    }
    authorized[teaCase.contractId] = teaCase.id
}
guard authorized.count == approvedAssets.count + approvedCases.count else {
    stop("Expected all nine approved tokens and four approved cases in the registries.")
}
let arguments = Array(CommandLine.arguments.dropFirst())
let listOnly = arguments == ["--list"]
let requested = arguments.isEmpty || listOnly ? authorized.keys.sorted() : arguments
// Validate the complete request before making any Keychain changes.
guard Set(requested).count == requested.count,
      requested.allSatisfy({ authorized[$0] != nil }) else {
    stop("Use only the nine approved token accounts and four approved case accounts under needmore_1_near.testnet.")
}
if listOnly {
    print(requested.joined(separator: "\n"))
    exit(0)
}
var userKeychain: SecKeychain?
let keychainStatus = SecKeychainCopyDomainDefault(.user, &userKeychain)
guard keychainStatus == errSecSuccess, let keychain = userKeychain else {
    stop("Could not open user Keychain (status \(keychainStatus)).")
}
var publicEntries: [[String: String]] = []
for account in requested {
    let service = "near-testnet-\(account)"
    // Only attributes are requested, never kSecReturnData or a secret value.
    var result: CFTypeRef?
    let status = SecItemCopyMatching([
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true
    ] as CFDictionary, &result)
    let publicKey: String
    if status == errSecSuccess {
        guard let matches = result as? [[String: Any]], matches.count == 1,
              let attribute = matches[0][kSecAttrAccount as String] as? String,
              attribute.hasPrefix(account + ":ed25519:") else {
            stop("Existing Keychain attributes are ambiguous for \(account); entry left unchanged.")
        }
        publicKey = String(attribute.dropFirst(account.count + 1))
        guard validPublicKey(publicKey) else {
            stop("Existing public-key attribute is invalid for \(account); entry left unchanged.")
        }
    } else if status == errSecItemNotFound {
        let key = Curve25519.Signing.PrivateKey()
        let publicBytes = key.publicKey.rawRepresentation
        publicKey = "ed25519:" + base58(publicBytes)
        let credential = ["public_key": publicKey,
                          "private_key": "ed25519:" + base58(key.rawRepresentation + publicBytes)]
        guard let payload = try? JSONSerialization.data(withJSONObject: credential) else {
            stop("Could not encode a new Keychain credential.")
        }
        let addStatus = SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: "\(account):\(publicKey)",
            kSecUseKeychain: keychain,
            kSecValueData: payload
        ] as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            stop("Keychain save failed for \(account) (status \(addStatus)); existing entries left unchanged.")
        }
    } else {
        stop("Could not check Keychain attributes for \(account) (status \(status)).")
    }
    guard let identity = authorized[account] else { stop("Account is outside the approved registry.") }
    publicEntries.append(["asset": identity, "accountId": account,
                          "publicKey": publicKey, "service": service])
}
let output: [String: Any] = ["network": "testnet", "keys": publicEntries]
guard let bytes = try? JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]),
      let json = String(data: bytes, encoding: .utf8) else {
    stop("Could not encode public-key report.")
}
print(json)
