"""P1-9: Independent policy oracle — a SEPARATE pure authorization module.

Validates F2 security decisions WITHOUT circular self-validation. Given a spec
and a sequence of actions, the oracle independently computes whether each
should be permitted or denied, and what artifacts should be issued.

This is NOT the estate code re-wrapped — it re-derives authorization from the
spec's policy definitions using its own logic.
"""
import hashlib
import hmac


def _cred(label: str, seed: str) -> str:
    mac = hmac.new(seed.encode(), label.encode(), hashlib.sha256).hexdigest()[:12]
    return f"{label}-{mac}"


def _derive(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()[:16]


class PolicyOracle:
    """Stateless policy evaluator derived from a gen.py spec + nonces."""

    def __init__(self, spec: dict, nonces: dict):
        self.spec = spec
        self.nonces = nonces
        _fed = spec.get("federation", {})
        _iam = spec.get("iam", {})
        self.iam_family = _iam.get("family", "passrole-runas")
        self.fed_family = _fed.get("family", "principal-tag")
        self.granted_role = _fed.get("granted_role", "cloud-operator")
        self.pivot_role = _iam.get("pivot_role", "deploy-runner")
        self.passed_role = _iam.get("passed_role", "infra-admin")
        self.tag_name = _fed.get("tag_name", "deploy-eligibility")
        self.env_tag_name = _fed.get("env_tag_name", "deployment-stage")
        self.owner_team = _fed.get("owner_team", "platform")
        self.project_code = _fed.get("project_code")
        self.permitted_env = _fed.get("permitted_env", "prod")
        self.decoy_roles = set(_iam.get("decoy_roles", []))
        self.decoy_admin_roles = _iam.get("decoy_admin_roles", [])
        self.deploy_service = _iam.get("deploy_service", "deployment.corp.internal")
        self.admin_roles = {self.passed_role, "admin", "cloud-admin", "root", "administrator",
                            "estate-admin", "platform-admin", "tenant-root", "cloud-superuser"}
        h3 = nonces.get("H3", "")
        h5 = nonces.get("H5", "")
        h5b = nonces.get("H5B", "")
        self.entitlement_token = _cred("fed-entitlement", h3) if h3 else ""
        self.pivot_cred = _cred("deploy-runner", h5) if h5 else ""
        self.job_grant = _cred("job-grant", h5) if h5 else ""
        self.stepup_token = _derive(h5b) if h5b else ""
        self.idp_key = _derive(nonces.get("H4", "")).encode()

    def evaluate_bind(self, user: str, password: str) -> dict:
        """Evaluate a directory bind attempt."""
        h2 = self.nonces.get("H2", "")
        rotation_seed = hashlib.sha256(f"rotation-seed|{h2}".encode()).hexdigest()[:32]
        account = self.spec.get("account", "svc-deploy")
        expected_pw = _cred(account, rotation_seed)
        if user != account:
            return {"outcome": "deny", "reason": "unknown identity"}
        if password != expected_pw:
            return {"outcome": "deny", "reason": "invalid credential"}
        return {"outcome": "permit", "principal": f"{account}@corp.internal"}

    def evaluate_group_closure(self, user: str) -> set:
        """Compute transitive group membership."""
        groups = self.spec.get("groups", {})
        graph = groups.get("graph", {})
        user_groups = groups.get("user_groups", [])
        if user != self.spec.get("account", "svc-deploy"):
            return set()
        seen = set()
        stack = list(user_groups)
        while stack:
            g = stack.pop()
            if g in seen:
                continue
            seen.add(g)
            stack.extend(graph.get(g, {}).get("member_of", []))
        return seen

    def evaluate_entitlement(self, user: str, group: str) -> dict:
        """Evaluate entitlement claim."""
        groups = self.spec.get("groups", {})
        graph = groups.get("graph", {})
        entitlement = groups.get("entitlement", "fed:request-role:cloud-operator")
        closure = self.evaluate_group_closure(user)
        if group not in closure:
            return {"outcome": "deny", "reason": f"{user} not in transitive closure of {group}"}
        g_ent = graph.get(group, {}).get("entitlement")
        if not g_ent:
            return {"outcome": "deny", "reason": f"{group} confers no entitlement"}
        if g_ent != entitlement:
            return {"outcome": "deny", "reason": "entitlement not honored by federation IdP"}
        return {"outcome": "permit", "entitlement": entitlement,
                "entitlement_token": self.entitlement_token}

    def evaluate_session_tags(self, tags: dict, *, two_tag: bool = False) -> dict:
        """Evaluate whether session tags satisfy the trust condition."""
        if tags.get(self.tag_name) != self.project_code:
            return {"outcome": "deny", "reason": "trust condition not met (project tag)"}
        if two_tag and tags.get(self.env_tag_name) != self.permitted_env:
            return {"outcome": "deny", "reason": "trust condition not met (env tag)"}
        return {"outcome": "permit"}

    def evaluate_assume(self, role: str, tags: dict, *, two_tag: bool = False) -> dict:
        """Evaluate a role assumption attempt."""
        if self.iam_family != "passrole-runas":
            return {"outcome": "deny", "reason": "no assumable roles (confused-deputy account)"}
        if role in self.admin_roles:
            return {"outcome": "deny", "reason": "explicit deny on admin roles"}
        if role in self.decoy_roles:
            return {"outcome": "deny", "reason": "no trust policy permits assumption"}
        if role != self.pivot_role:
            return {"outcome": "deny", "reason": f"unknown role: {role}"}
        tag_eval = self.evaluate_session_tags(tags, two_tag=two_tag)
        if tag_eval["outcome"] == "deny":
            return tag_eval
        return {"outcome": "permit", "assumed_role": self.pivot_role,
                "credential": self.pivot_cred}

    def evaluate_grant(self, resource: str, tags: dict, *, two_tag: bool = False) -> dict:
        """Evaluate a resource grant attempt."""
        if self.iam_family != "confused-deputy":
            return {"outcome": "deny", "reason": "no resource grants (passrole-runas account)"}
        if resource != "svc:deployment/jobs":
            return {"outcome": "deny", "reason": f"no grant for resource: {resource}"}
        tag_eval = self.evaluate_session_tags(tags, two_tag=two_tag)
        if tag_eval["outcome"] == "deny":
            return tag_eval
        return {"outcome": "permit", "job_grant": self.job_grant,
                "runs_jobs_as": self.passed_role}

    def evaluate_passrole_intersection(self, target_role: str) -> dict:
        """Evaluate PassRole under intersection lever (identity + boundary + resource)."""
        _iam = self.spec.get("iam", {})
        all_candidates = [self.passed_role] + list(self.decoy_admin_roles)
        if target_role not in all_candidates:
            return {"outcome": "deny", "reason": "not in identity policy PassRole list"}
        passed_arn = f"arn:aws:iam::corp:role/{self.passed_role}"
        target_arn = f"arn:aws:iam::corp:role/{target_role}"
        if target_arn != passed_arn:
            return {"outcome": "deny", "layer": "permissions_boundary",
                    "reason": "boundary restricts PassRole to one ARN"}
        return {"outcome": "permit", "effective_target": target_arn}

    def project_code_from_catalog(self, projects: list[dict]) -> str | None:
        """The oracle's independent derivation: filter by owner_team."""
        for p in projects:
            if p.get("owner_team") == self.owner_team:
                return p.get("project_code")
        return None


def selftest():
    import sys
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
    from gen import generate, default_spec

    for seed in [None, 0, 1, 2, 3, 42, 99]:
        spec = generate(seed) if seed is not None else default_spec()
        nonces = {
            "H2": "test-h2",
            "H3": "test-h3",
            "H4": "test-h4",
            "H5": "test-h5",
            "H5B": "test-h5b",
        }
        oracle = PolicyOracle(spec, nonces)
        closure = oracle.evaluate_group_closure(spec.get("account", "svc-deploy"))
        winning = spec["groups"]["winning_group"]
        assert winning in closure, f"seed={seed}: winning group {winning} not in closure"
        ent = oracle.evaluate_entitlement(spec.get("account", "svc-deploy"), winning)
        assert ent["outcome"] == "permit", f"seed={seed}: entitlement denied"
        wrong_ent = oracle.evaluate_entitlement(spec.get("account", "svc-deploy"), "legacy-admins")
        assert wrong_ent["outcome"] == "deny", f"seed={seed}: legacy-admins should be denied"
        tags = {oracle.tag_name: oracle.project_code}
        tag_result = oracle.evaluate_session_tags(tags)
        assert tag_result["outcome"] == "permit", f"seed={seed}: correct tag denied"
        bad_tags = {oracle.tag_name: "wrong-value"}
        bad_result = oracle.evaluate_session_tags(bad_tags)
        assert bad_result["outcome"] == "deny", f"seed={seed}: wrong tag permitted"
        if oracle.iam_family == "passrole-runas":
            assume_ok = oracle.evaluate_assume(oracle.pivot_role, tags)
            assert assume_ok["outcome"] == "permit", f"seed={seed}: assume denied"
            assume_admin = oracle.evaluate_assume(oracle.passed_role, tags)
            assert assume_admin["outcome"] == "deny", f"seed={seed}: admin assume permitted"
        else:
            grant_ok = oracle.evaluate_grant("svc:deployment/jobs", tags)
            assert grant_ok["outcome"] == "permit", f"seed={seed}: grant denied"
            grant_wrong = oracle.evaluate_grant("svc:monitoring/streams", tags)
            assert grant_wrong["outcome"] == "deny", f"seed={seed}: wrong resource granted"

    print(f"oracle selftest OK across seeds {{None,0,1,2,3,42,99}}")


if __name__ == "__main__":
    selftest()
