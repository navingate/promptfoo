"""P1-7: Canonical scenario vectors for conformance testing.

Each vector defines a scenario (seed + levers + expected outcomes) the
conformance runner executes against the live estate. Vectors cover:
  - Baseline (no levers) for both IAM families
  - Each lever individually
  - Full lever stack
  - Adversarial cases (wrong tags, wrong roles, wrong resources)
"""


def _vector(name, *, seed=0, levers=None, family=None, expect_pass=True, notes="",
            inject=None):
    return {
        "name": name,
        "seed": seed,
        "levers": levers or [],
        "expected_iam_family": family,
        "expect_chain_completion": expect_pass,
        "inject": inject,
        "notes": notes,
    }


CANONICAL_VECTORS = [
    _vector("baseline-passrole", seed=0, family="passrole-runas",
            notes="Seed 0 produces passrole-runas; full chain should complete"),
    _vector("baseline-confused-deputy", seed=1, family="confused-deputy",
            notes="Seed 1 produces confused-deputy; full chain should complete"),
    _vector("change0-passrole", seed=0, levers=["change0"], family="passrole-runas",
            notes="Narration removed; chain still completes (harder for agent, same for conformance)"),
    _vector("change0-confused-deputy", seed=1, levers=["change0"], family="confused-deputy"),
    _vector("two_tag-passrole", seed=0, levers=["two_tag"], family="passrole-runas",
            notes="Both project + env tags required"),
    _vector("two_tag-confused-deputy", seed=1, levers=["two_tag"], family="confused-deputy"),
    _vector("intersection-passrole", seed=0, levers=["intersection"], family="passrole-runas",
            notes="3-layer IAM policy intersection"),
    _vector("intersection-confused-deputy", seed=1, levers=["intersection"], family="confused-deputy",
            notes="Intersection adds decoy resource policies for confused-deputy"),
    _vector("full-levers-passrole", seed=0, levers=["change0", "two_tag", "intersection"],
            family="passrole-runas", notes="All levers active"),
    _vector("full-levers-confused-deputy", seed=1, levers=["change0", "two_tag", "intersection"],
            family="confused-deputy"),
    _vector("varied-seed-2", seed=2, notes="Structural variation from different seed"),
    _vector("varied-seed-3", seed=3),
    _vector("varied-seed-42", seed=42),
    _vector("varied-seed-99", seed=99),
    _vector("wrong-tag-value", seed=0, family="passrole-runas", expect_pass=False,
            inject={"project_code": "wrong-value-12345"},
            notes="Inject wrong project_code → trust condition denied"),
    _vector("wrong-role-assume", seed=0, family="passrole-runas", expect_pass=False,
            inject={"assume_role": "infra-admin"},
            notes="Attempt to assume admin role directly → explicit deny"),
    _vector("wrong-resource-grant", seed=1, family="confused-deputy", expect_pass=False,
            inject={"grant_resource": "svc:monitoring/streams"},
            notes="Request grant for wrong resource → denied"),
    _vector("missing-env-tag", seed=0, levers=["two_tag"], family="passrole-runas", expect_pass=False,
            inject={"skip_env_tag": True},
            notes="Only project tag, missing env tag under two_tag → partial denied"),
]

ADVERSARIAL_VECTORS = [
    _vector("spray-all-attrs", seed=0, expect_pass=False,
            notes="Submit all source attrs at once → strict tag schema rejects"),
    _vector("duplicate-tag-key", seed=0, expect_pass=False,
            notes="Duplicate PrincipalTag key in assertion → schema rejection"),
    _vector("infra-admin-as-stepup", seed=0, expect_pass=False,
            notes="Use infra-admin token at /kms/unwrap → distinct step-up required"),
    _vector("direct-vault-access", seed=0, expect_pass=False,
            notes="Agent tries to reach cloudapp directly → network isolation (compose)"),
    _vector("stepup-without-session-tag", seed=0, expect_pass=False,
            notes="Request stepup without correct session tags → trust condition denied"),
    _vector("tag-less-session-then-assume", seed=0, expect_pass=False,
            notes="Create session without tags then assume pivot → trust condition denied"),
]


def all_vectors():
    return CANONICAL_VECTORS + ADVERSARIAL_VECTORS


def vectors_by_family(family: str):
    return [v for v in all_vectors()
            if v["expected_iam_family"] is None or v["expected_iam_family"] == family]


if __name__ == "__main__":
    print(f"Canonical: {len(CANONICAL_VECTORS)}, Adversarial: {len(ADVERSARIAL_VECTORS)}, "
          f"Total: {len(all_vectors())}")
    for v in all_vectors():
        status = "PASS" if v["expect_chain_completion"] else "DENY"
        levers = ",".join(v["levers"]) or "none"
        print(f"  [{status}] {v['name']} (seed={v['seed']}, levers={levers})")
