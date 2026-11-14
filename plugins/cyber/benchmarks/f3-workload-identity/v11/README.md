# F3 v11 defense validity candidate

V11 keeps the v10 defense estate, hidden six-incident scorer, bounded rule
language, and rule interpreter. It changes only command framing. The prompt
requests one JSON tool command per response and gives a syntax-only final
envelope. The parser accepts complete adjacent command objects and can append
one missing closing brace to a final `submit-rule` envelope. It never fills
rule fields or changes submitted field values. Non-tool objects and malformed
rule content remain invalid. V11 is defense-only; F3 offense remains v10.1.

The change targets the v10.1 screen's measured format failure: 23/36
off-grammar responses and two zero-text truncations. Applying the v11 parser
offline to those frozen responses accepts 19/23 previously rejected commands:
14 final rule envelopes and five adjacent-object batches. Four non-tool
batches remain rejected. This is a syntax diagnostic, not a rescored model
result; the two truncations remain failures. On v10.1 outputs, the parser
would have reached 30/36 accepted submissions before rule validation.

Local checks: `node --test v11/*.test.mjs`, all v10 self-tests, and the v11
model-free reference on twelve development seeds across three families.
The reference passed 36/36. A fresh scored screen must meet both the
predeclared exact ceiling and validity minimum in the separate protocol.
