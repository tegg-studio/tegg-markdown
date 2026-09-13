import { describe, expect, it } from "vitest";
import { markdownParser } from "./markdownParser";

describe("Markdown Guide reading coverage", () => {
  it("renders every basic syntax family", () => {
    const html = markdownParser.render(`
# ATX heading

Setext heading
--------------

Paragraph one.${"  "}
Second line with **bold**, _italic_, and ***both***.

> Quote
>> Nested quote

1. Ordered
   - Nested unordered

\`inline code\`

    indented code

---

[Link](https://example.com "Title") and <reader@example.com>.

[Reference link][guide]

[guide]: https://www.markdownguide.org "Guide"

[![Linked image](image.png "Image")](https://example.com)

\\*escaped asterisk\\*

<em>safe HTML emphasis</em>
`);

    expect(html).toContain("<h1>ATX heading</h1>");
    expect(html).toContain("<h2>Setext heading</h2>");
    expect(html).toContain("<br>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain("indented code");
    expect(html).toContain("<hr>");
    expect(html).toContain('title="Title"');
    expect(html).toContain('href="mailto:reader@example.com"');
    expect(html).toContain('href="https://www.markdownguide.org"');
    expect(html).toContain('src="image.png"');
    expect(html).toContain("*escaped asterisk*");
    expect(html).toContain("<em>safe HTML emphasis</em>");
  });

  it("renders every extended syntax family", () => {
    const html = markdownParser.render(`
| Left | Center | Right |
| :--- | :----: | ----: |
| **A** | \`B\` | C &#124; D |

~~~json
{"ready": true}
~~~

Footnote reference.[^note]

[^note]: Footnote body.

### Custom heading {#custom-id}

Term
: First definition.
: Second definition.

~~removed~~

- [x] Complete
- [ ] Pending

Direct emoji 😀 and shortcodes :tent: :joy:

==important==, H~2~O, and X^2^.

https://example.com

\`https://example.org\`
`);

    expect(html).toContain('class="align-left"');
    expect(html).toContain('class="align-center"');
    expect(html).toContain('class="align-right"');
    expect(html).not.toContain("text-align:");
    expect(html).toContain('class="language-json"');
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('<h3 id="custom-id">Custom heading</h3>');
    expect(html).toContain("<dl>");
    expect(html).toContain("<dt>Term</dt>");
    expect(html).toContain("<dd>First definition.</dd>");
    expect(html).toContain("<s>removed</s>");
    expect(html).toContain('class="task-list-item enabled"');
    expect(html).toContain("⛺");
    expect(html).toContain("😂");
    expect(html).toContain("<mark>important</mark>");
    expect(html).toContain("H<sub>2</sub>O");
    expect(html).toContain("X<sup>2</sup>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<code>https://example.org</code>");
  });

  it("accepts custom heading IDs without enabling arbitrary attributes", () => {
    const html = markdownParser.render("## Safe {#safe-id}\n\n## Visible {onclick=alert(1)}");
    expect(html).toContain('<h2 id="safe-id">Safe</h2>');
    expect(html).toContain("Visible {onclick=alert(1)}");
    expect(html).not.toContain("<h2 onclick=");
  });
});
