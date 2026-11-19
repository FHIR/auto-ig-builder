"""Tests for prune-stale. Run: python3 -I images/ci-build/test_prune_stale.py"""

import importlib.machinery
import importlib.util
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
os.environ["PRUNE_UPLOADING"] = TMP
os.environ["PRUNE_REINDEX_QUEUE"] = os.path.join(TMP, "reindex_queue")
_loader = importlib.machinery.SourceFileLoader("prune_stale", os.path.join(HERE, "prune-stale"))
_spec = importlib.util.spec_from_loader("prune_stale", _loader)
ps = importlib.util.module_from_spec(_spec)
_loader.exec_module(ps)

H = 3600


def ok(heads, tags=(), head="main"):
    return ("ok", set(heads), set(tags), head)


class Decide(unittest.TestCase):
    def run_scans(self, pub, listings_per_scan, times, grace=24 * H):
        state = {}
        out = None
        for listings, t in zip(listings_per_scan, times):
            out = ps.decide(pub, listings, state, t, grace=grace)
        return out, state

    def test_gone_branch_needs_two_scans_across_grace(self):
        pub = {("o", "r"): {"main", "old"}}
        lst = {("o", "r"): ok(["main"])}
        out, _ = self.run_scans(pub, [lst], [0])
        self.assertEqual(out["delete_branches"], [])
        self.assertEqual([p["branch"] for p in out["pending"]], ["old"])
        out, _ = self.run_scans(pub, [lst, lst], [0, 23 * H])
        self.assertEqual(out["delete_branches"], [])
        out, _ = self.run_scans(pub, [lst, lst], [0, 24 * H])
        self.assertEqual([d["branch"] for d in out["delete_branches"]], ["old"])

    def test_zero_grace_still_needs_two_scans(self):
        pub = {("o", "r"): {"main", "old"}}
        lst = {("o", "r"): ok(["main"])}
        out, _ = self.run_scans(pub, [lst], [0], grace=0)
        self.assertEqual(out["delete_branches"], [])
        out, _ = self.run_scans(pub, [lst, lst], [0, 1], grace=0)
        self.assertEqual(len(out["delete_branches"]), 1)

    def test_tag_counts_as_existing(self):
        pub = {("IHE", "ITI.MHD"): {"master", "4.2.5"}}
        lst = {("IHE", "ITI.MHD"): ok(["master"], tags=["4.2.5"], head="master")}
        out, _ = self.run_scans(pub, [lst, lst], [0, 48 * H])
        self.assertEqual(out["delete_branches"], [])
        self.assertEqual(out["pending"], [])

    def test_branch_that_comes_back_is_forgotten(self):
        pub = {("o", "r"): {"main", "b"}}
        gone, back = {("o", "r"): ok(["main"])}, {("o", "r"): ok(["main", "b"])}
        out, state = self.run_scans(pub, [gone, back, gone], [0, 30 * H, 31 * H])
        self.assertEqual(out["delete_branches"], [])
        self.assertEqual(state["branches"]["o/r/b"]["first"], 31 * H)

    def test_official_main_master_kept(self):
        pub = {("HL7", "cgm"): {"master", "main", "feature"}}
        lst = {("HL7", "cgm"): ok(["main"])}
        out, _ = self.run_scans(pub, [lst, lst], [0, 48 * H])
        self.assertEqual([d["branch"] for d in out["delete_branches"]], ["feature"])
        self.assertEqual([k["branch"] for k in out["kept"]], ["master"])

    def test_other_orgs_master_is_pruned(self):
        pub = {("someone", "ig"): {"master", "main"}}
        lst = {("someone", "ig"): ok(["main"])}
        out, _ = self.run_scans(pub, [lst, lst], [0, 48 * H])
        self.assertEqual(out["delete_branches"][0]["branch"], "master")
        self.assertEqual(out["delete_branches"][0]["github_default"], "main")

    def test_unknown_changes_nothing(self):
        pub = {("o", "r"): {"main", "old"}}
        gone, unknown = {("o", "r"): ok(["main"])}, {("o", "r"): ("unknown", "timeout")}
        out, state = self.run_scans(pub, [gone, unknown], [0, 48 * H])
        self.assertEqual(out["delete_branches"], [])
        self.assertEqual(state["branches"]["o/r/old"], {"first": 0, "seen": 1})
        out, state = self.run_scans(pub, [gone, unknown, gone], [0, 48 * H, 49 * H])
        self.assertEqual(len(out["delete_branches"]), 1)

    def test_missing_repo_removed_after_grace(self):
        pub = {("gone", "repo"): {"main"}}
        nf = {("gone", "repo"): ("not_found",)}
        out, _ = self.run_scans(pub, [nf], [0])
        self.assertEqual(out["delete_repos"], [])
        out, _ = self.run_scans(pub, [nf, nf], [0, 24 * H])
        self.assertEqual([d["repo"] for d in out["delete_repos"]], ["gone/repo"])

    def test_repo_reappearing_is_forgotten(self):
        pub = {("o", "r"): {"main"}}
        nf, back = {("o", "r"): ("not_found",)}, {("o", "r"): ok(["main"])}
        out, state = self.run_scans(pub, [nf, back], [0, 30 * H])
        self.assertEqual(state["repos"], {})
        self.assertEqual(out["delete_repos"], [])


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.root = ps.IG_ROOT
        if os.path.exists(self.root):
            import shutil
            shutil.rmtree(self.root)
        b = os.path.join(self.root, "o", "r", "branches")
        for name in ("master", "main", "x_y", "unverändert"):
            os.makedirs(os.path.join(b, name, "sub"))
        os.symlink("./master", os.path.join(b, "__default"))
        os.symlink("/etc", os.path.join(b, "evil"))
        os.makedirs(os.path.join(self.root, "o", "r", "branches", "..bad"), exist_ok=True)
        self.b = b

    def test_published_lists_real_safe_folders(self):
        self.assertEqual(ps.published(), {("o", "r"): {"master", "main", "x_y", "unverändert", "..bad"}})

    def test_delete_repoints_default_to_github_default(self):
        note = ps.delete_branch("o", "r", "master", "main")
        self.assertFalse(os.path.exists(os.path.join(self.b, "master")))
        self.assertEqual(os.readlink(os.path.join(self.b, "__default")), "./main")
        self.assertIn("main", note)

    def test_delete_removes_default_when_github_default_unbuilt(self):
        ps.delete_branch("o", "r", "master", "develop")
        self.assertFalse(os.path.lexists(os.path.join(self.b, "__default")))

    def test_delete_other_branch_leaves_default(self):
        ps.delete_branch("o", "r", "x_y", "main")
        self.assertEqual(os.readlink(os.path.join(self.b, "__default")), "./master")

    def test_refuses_symlink_and_outside_root(self):
        with self.assertRaises(RuntimeError):
            ps.remove(os.path.join(self.b, "evil"))
        with self.assertRaises(RuntimeError):
            ps.remove(os.path.join(self.root, "..", "prune-state.json"))
        self.assertTrue(os.path.isdir("/etc"))

    def test_safe_names(self):
        for good in ("HL7", "us-core", "x_y", "1.0.0", "a+b,c", "unverändert"):
            self.assertTrue(ps.safe(good), good)
        for bad in (".", "..", "a/b", "a b", "", "a;b", "$(x)"):
            self.assertFalse(ps.safe(bad), bad)


if __name__ == "__main__":
    unittest.main(verbosity=1)
