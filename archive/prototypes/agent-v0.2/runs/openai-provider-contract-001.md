# OpenAI Responses Provider Contract 001

> Date: 2026-08-22
>
> Result: mocked transport and full runtime mapping passed; live API/model UX pending
>
> Official basis: [OpenAI Responses API — Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

## 1. Scope

This run adds one replaceable model provider adapter for the first-party Helm Agent Runtime. It does not place OpenAI concepts in Kernel Commands, Events, Projection, Authority, or adapter protocol.

```text
OpenAI Responses JSON
  ↕ provider adapter only
helm.provider-turn.v0.2-candidate
  ↕
First-party Agent Runtime
  ↕ typed Helm tools
Portable Kernel
```

No live API request was made. Tests use an injected mock transport, explicit test model, and non-production key placeholder.

## 2. Official API features used

The official Responses API supports custom function tools, tool selection, parallel-tool-call control, JSON outputs, output-token limits, response storage control, and an ordered output item array. The adapter maps only those provider concerns.

Request policy:

```text
store                 false
truncation            disabled
parallel_tool_calls   false
max_output_tokens     explicit
model                 explicit; no hidden default
tools                 current Helm runtime function tools only
tool_choice           auto
text.format           strict JSON Schema for non-tool Provider Turn
input                  bounded HELM_CONTEXT_JSON
```

Helm's runtime step/tool limits remain authoritative because provider-side limits do not replace cross-provider policy.

## 3. Function tool mapping

Each Helm runtime tool maps to a custom function with:

- closed input JSON Schema;
- provider-visible effect/cancellation/enforcement description;
- `strict: true` for the first-party Helm tool set;
- no Human acceptance function;
- no raw Event or generic Command function.

The runtime validates tool arguments again. Provider schema enforcement is defense in depth, not the trust boundary.

Dynamic Kernel data is normalized before the provider boundary. For example, Completion criteria use an explicit array of `{criterion, status}` rather than an unrestricted object map.

## 4. Output mapping

### Function-call response

Responses output items with `type: function_call` map to:

```text
call_id    → runtime tool-call ID
name       → registered Helm tool name
arguments  → parsed object
```

Malformed JSON arguments fail closed. A response containing both function calls and user-visible message text is rejected because the runtime turn contract forbids mixing effects and presentation.

### Structured message response

Message `output_text` must decode to the strict Provider Turn schema:

```text
blocks  message | possibility | explanation | progress
gate    choice | agreement | result | null
finish  yield | null
```

Semantic surface labels remain runtime-owned.

## 5. Full mocked runtime fixture

The mock Responses server returned:

1. `helm_open_choice` function call;
2. `helm_qualify_choice` function call;
3. structured Choice Gate.

The first-party runtime:

- sent Context cursor `0`, then `1`, then `2`;
- executed each function through strict runtime tools and typed client;
- created exactly two candidate Events;
- exposed no Human acceptance tool in any API request;
- stopped in `awaiting_user` with no active Choice;
- committed the Choice only when the separate Human client resolved the cursor-bound Gate.

## 6. Security and failure behavior

- API key is held in a private provider field and sent only in the Authorization header;
- request body, Events, Context Projection, and error details do not contain the key;
- HTTP errors expose status but not remote response bodies by default;
- incomplete responses preserve the incomplete reason and do not fabricate a turn;
- transport cancellation uses the runtime AbortSignal;
- usage data goes to an operational callback, not canonical state;
- invalid, empty, mixed, and incomplete outputs fail closed.

## 7. Evidence

Seven provider-focused fixtures plus the existing runtime/kernel suite pass:

- stateless request mapping;
- strict structured message mapping;
- invalid function argument rejection;
- mixed-output rejection;
- credential-safe HTTP/incomplete errors;
- explicit model/key requirement;
- full mocked Responses → Runtime → Kernel → Human Gate path.

Candidate suite after this run: **48 passed, 0 failed**.

## 8. Remaining limits

- no live account/API key/model call;
- no streaming output or partial function-argument decoder;
- no actual latency, cost, rate-limit, retry, or model-quality measurement;
- no provider-specific token counter;
- no safety identifier/prompt cache policy decision;
- no encrypted reasoning/context carryover;
- no multi-provider fallback policy;
- no user choice of model/provider in CLI configuration.

The next live run requires explicit provider/model choice and credential availability. A successful mock contract is not evidence that a real model follows the Foundation reliably.
