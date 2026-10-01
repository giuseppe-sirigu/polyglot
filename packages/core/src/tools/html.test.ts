import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "./html.js";

describe("decodeEntities", () => {
  it("decodes each entity once", () => {
    expect(decodeEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeEntities("a &lt; b &amp;&amp; c &#62; d &#x3C;")).toBe("a < b && c > d <");
  });

  it("leaves unknown or out-of-range references as written", () => {
    expect(decodeEntities("&copy2; &#99999999;")).toBe("&copy2; &#99999999;");
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles whose end tag has whitespace or attributes", () => {
    expect(htmlToText("a<script>x()</script >b<style>p{}</style\n>c")).toBe("a b c");
  });
});
