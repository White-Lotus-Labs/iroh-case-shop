import CryptoKit
import Foundation
import Security

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
    let leadingZeros = bytes.prefix(while: { $0 == 0 }).count
    return String(repeating: "1", count: leadingZeros)
        + String(digits.reversed().map { alphabet[$0] })
}

func stop(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 1 else { stop("Run this helper without arguments.") }
let account = "cases-needmore-1-near.testnet"
let service = "near-testnet-\(account)"
var userKeychain: SecKeychain?
let keychainStatus = SecKeychainCopyDomainDefault(.user, &userKeychain)
guard keychainStatus == errSecSuccess, let keychain = userKeychain else {
    stop("Could not open the user Keychain (status \(keychainStatus)).")
}

// Query only whether an item exists. Do not request its data or replace it.
let existingStatus = SecItemCopyMatching([
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: service,
    kSecMatchSearchList: [keychain]
] as CFDictionary, nil)
guard existingStatus == errSecItemNotFound else {
    stop("Keychain setup stopped: this service already exists or could not be checked (status \(existingStatus)).")
}

let key = Curve25519.Signing.PrivateKey()
let publicBytes = key.publicKey.rawRepresentation
let publicKey = "ed25519:" + base58(publicBytes)
// NEAR stores Ed25519 keypairs as the 32-byte seed followed by the public key.
let credential: [String: String] = [
    "public_key": publicKey,
    "private_key": "ed25519:" + base58(key.rawRepresentation + publicBytes)
]
guard let payload = try? JSONSerialization.data(withJSONObject: credential) else {
    stop("Could not encode the new Keychain entry.")
}
let status = SecItemAdd([
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: service,
    kSecAttrAccount: "\(account):\(publicKey)",
    kSecUseKeychain: keychain,
    kSecValueData: payload
] as CFDictionary, nil)
guard status == errSecSuccess else { stop("Keychain save failed (status \(status)).") }
print(publicKey)
