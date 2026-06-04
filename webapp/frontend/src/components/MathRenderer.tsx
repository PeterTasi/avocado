import katex from "katex";
import "katex/dist/katex.min.css";

interface Props {
  text: string;
  className?: string;
}

/** Splits text on $...$ and \(...\) delimiters, renders math with KaTeX. */
export function MathRenderer({ text, className }: Props) {
  // Match $...$ (inline) or \(...\) delimiters
  const parts = text.split(/(\$[^$]+\$|\\\([^)]+\\\))/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const dollarMatch = part.startsWith("$") && part.endsWith("$") && part.length > 2;
        const parenMatch = part.startsWith("\\(") && part.endsWith("\\)");

        if (dollarMatch || parenMatch) {
          const latex = dollarMatch ? part.slice(1, -1) : part.slice(2, -2);
          try {
            const html = katex.renderToString(latex, { throwOnError: false, output: "html" });
            return (
              <span
                key={i}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is safe
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          } catch {
            return <span key={i}>{part}</span>;
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
