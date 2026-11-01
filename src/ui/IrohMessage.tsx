import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) tokens.push(text.slice(at, index));
    const key = index;
    if (match[2]) tokens.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3]) tokens.push(<em key={key}>{match[3]}</em>);
    else if (match[4]) tokens.push(<code key={key}>{match[4]}</code>);
    else if (match[5]) {
      const href = match[6];
      tokens.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {match[5]}
          </a>
        ) : (
          match[0]
        ),
      );
    }
    at = index + match[0].length;
  }
  if (at < text.length) tokens.push(text.slice(at));
  return tokens;
}

export function IrohMessage({ content }: { content: string }) {
  const blocks = content.trim().split(/\n\s*\n/);
  return (
    <div className="iroh-markdown">
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        const bullets = lines.every((line) => /^\s*[-*] /.test(line));
        const numbers = lines.every((line) => /^\s*\d+\. /.test(line));
        if (bullets || numbers) {
          const items = lines.map((line, i) => (
            <li key={i}>{inline(line.replace(/^\s*(?:[-*]|\d+\.) /, ''))}</li>
          ));
          // Answers often put a blank line between items, so each one is its
          // own block: keep counting from the block's first number.
          return bullets ? (
            <ul key={index}>{items}</ul>
          ) : (
            <ol key={index} start={parseInt(lines[0], 10)}>
              {items}
            </ol>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {inline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
