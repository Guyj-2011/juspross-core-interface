import { expect, test } from "bun:test";
import { createSseParser, stripReasoning } from "./sse";
import { nemotronDelta, validateNemotronInput } from "./nemotronRequest";
test("SSE across chunk boundaries", () => {
  const out: string[] = []; const p = createSseParser((d) => out.push(d));
  p.push("data: {\"a\""); p.push(":1}\r\n\r\nda"); p.push("ta: [DONE]\n\n"); p.end();
  expect(out).toEqual(['{"a":1}', "[DONE]"]);
});
test("reasoning is dropped", () => {
  expect(stripReasoning("<think>x</think>Hola")).toBe("Hola");
  expect(nemotronDelta('{"choices":[{"delta":{"reasoning_content":"x"}}]}')).toEqual({});
});
test("validation rejects bad roles and caps tokens", () => {
  expect(validateNemotronInput({ messages: [{ role: "tool", content: "x" }] }).ok).toBe(false);
  const v = validateNemotronInput({ messages: [{ role: "user", content: "hi" }], maxTokens: 99999 });
  expect(v.ok && v.maxTokens).toBe(1024);
});
