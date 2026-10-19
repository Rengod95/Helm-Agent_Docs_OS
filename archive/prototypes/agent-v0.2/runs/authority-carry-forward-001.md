# Authority Carry-forward Baseline 001

> Date: 2026-08-22
>
> Result: non-expanding Work Agreement activation passed; natural-language grant extraction and production enforcement pending
>
> UX question source: [`helm-cli-linear-001.md`](helm-cli-linear-001.md)

## 1. Problem

The linear CLI avoided a second approval question when moving from an accepted architecture Choice into a local Work Agreement. That lowers friction, but simply treating “fix it” as unlimited continuing permission would violate the Foundation:

- authority must have scope and effect class;
- a Work Agreement must not widen the user's instruction silently;
- an Agent cannot manufacture Human acceptance;
- advisory integration must not be presented as enforced sandboxing.

The run therefore replaced implicit authority carry-forward with an explicit A-plane contract.

## 2. Authority Grant candidate

A direct Human Command creates an Authority Grant with:

```text
grant reference
grantor and grantee Actor
purpose
allowed action classes
maximum effect class R0–R4
resource scopes
expiry
stop conditions
source instruction reference
```

Example for `CLI-G01`:

```text
grantee          agent:helm-cli
actions          repository.read, repository.local_write, test.run, docs.edit
maximum effect   R1 reversible local mutation
resources        local workspace
expires          next day
stop             guessed acceptance or non-replayable migration loss
source           initial user request
```

The Agent typed client has no `grantAuthority` method. Only the Human client can create the Grant.

## 3. Work Agreement activation

The Agent offers a Work Agreement with structured requested authority. It may invoke `agreement.activate`, but Kernel policy accepts only when every requested dimension is contained by the Human Grant:

```text
same grantee
requested actions ⊆ granted actions
requested effect ≤ granted effect
every requested resource covered by a granted scope
every Grant stop condition retained
Grant not expired
```

When this proof passes, the Agreement becomes active with:

```text
acceptance mode  delegated-authority
accepted by      original human grantor
activated by     agent
authority basis  explicit Grant reference
```

This is not a forged Human action. The Agent performs a policy-checked activation under prior Human authority, and Event provenance preserves both roles.

## 4. Gate conditions

The following injected Agreement requested:

- `remote.publish`, which was not granted;
- effect class R2 instead of R1;
- `remote:production`, outside local resource scope.

Activation returned:

```text
status  needs_gate
code    gate.work_agreement_authority_required
missing actionClass:remote.publish
        effectClass<=R1
        resourceScope:remote:production
```

Separate fixtures also confirmed:

- omitting a Grant stop condition requires a Gate;
- an expired Grant requires a Gate;
- another Actor cannot use the Grant;
- a Work Agreement with no structured authority request cannot activate by carry-forward.

## 5. UX consequence

The recommended Guided rule becomes:

> Do not ask again when the next Work Agreement is a proven subset of a visible, current Human instruction. Echo the resulting range and keep correction available. Ask when any dimension expands or cannot be proven.

The default CLI need not display “Authority Grant.” It can say:

```text
맡긴 범위
- 이 저장소 안에서 읽기, 되돌릴 수 있는 수정, 테스트, 문서 변경
- 외부 공개·배포 없음
- 추정으로 기존 결정을 수락해야 하면 멈춤
- 내일까지 유효
```

Developer/assurance views retain Grant IDs, effect classes, policy reasons, and provenance.

## 6. Evidence

Five focused authority fixtures pass:

1. bounded Agreement activates without a second Human Command;
2. effect/resource/action expansion returns a Gate;
3. omitted stop condition returns a Gate;
4. expired Grant returns a Gate;
5. Agent cannot grant itself authority.

Candidate suite after this run: **33 passed, 0 failed**.

## 7. Remaining limits

- scope coverage uses a small prefix contract, not a mature resource policy language;
- no revocation, budget consumption, lease renewal, or overlapping Grant conflict yet;
- Actor identity is not production-authenticated;
- the mapping from natural-language user instruction to structured Grant has not been model-tested;
- R1 “reversible” is declared, not yet tied to a rollback implementation;
- external runtimes without interception still provide advisory rather than enforced effect control.

## 8. Foundation refinement

Authority carry-forward is valid only as a proof obligation:

```text
RequestedAuthority(Agreement) ⊆ CurrentAuthorityGrant(Actor, WorkUnit)
```

Absence of evidence for expansion safety is not permission. It yields a Gate or a narrower Agreement draft.
