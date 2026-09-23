import contextlib
import io
import unittest
from unittest.mock import patch

import cleanup_develop_tags as cleanup


def version(number, *tags):
    return {"id": number, "metadata": {"container": {"tags": list(tags)}}}


class CleanupTests(unittest.TestCase):
    def setUp(self):
        output = contextlib.redirect_stdout(io.StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)
        env = patch.dict(cleanup.os.environ, {
            "GH_TOKEN": "test", "DOCKERHUB_USERNAME": "test", "DOCKERHUB_TOKEN": "test",
        })
        env.start()
        self.addCleanup(env.stop)

    def test_only_commit_tags_match(self):
        for tag in ("develop-abcdef0", "develop-" + "a" * 40):
            self.assertTrue(cleanup.legacy_tag(tag))
        for tag in ("develop", "latest", "2.11.0", "2.11", "v2.11.0", "develop-beta",
                    "develop-abcdef0-extra", "develop-abc", "develop-" + "a" * 41):
            self.assertFalse(cleanup.legacy_tag(tag), tag)

    def test_shared_and_untagged_versions_are_kept(self):
        self.assertTrue(cleanup.legacy_version(version(1, "develop-abcdef0")))
        for tags in ([], ["develop"], ["develop-abcdef0", "develop"],
                     ["develop-abcdef0", "latest"], ["develop-abcdef0", "2.11.0"],
                     ["develop-abcdef0", "custom"]):
            self.assertFalse(cleanup.legacy_version(version(1, *tags)), tags)

    @patch.object(cleanup, "request")
    def test_hub_lists_all_pages_before_deleting_only_commit_tags(self, request):
        second_page = cleanup.HUB + "?page=2&page_size=100"
        request.side_effect = [
            {"access_token": "test"},
            {"results": [{"name": "develop"}, {"name": "develop-abcdef0"}], "next": second_page},
            {"results": [{"name": "latest"}, {"name": "2.11.0"}, {"name": "develop-1234567"}], "next": None},
            None, None,
        ]
        cleanup.cleanup_dockerhub(apply=True)
        calls = request.call_args_list
        self.assertEqual(calls[2].args[0], second_page)
        self.assertEqual([c.args[0] for c in calls if c.kwargs.get("method") == "DELETE"], [
            cleanup.HUB + "develop-abcdef0/", cleanup.HUB + "develop-1234567/",
        ])

    @patch.object(cleanup, "request")
    def test_hub_preview_never_authenticates_or_deletes(self, request):
        request.return_value = {"results": [{"name": "develop"}, {"name": "develop-abcdef0"}], "next": None}
        cleanup.cleanup_dockerhub()
        self.assertEqual(request.call_count, 1)
        self.assertNotIn("method", request.call_args.kwargs)

    @patch.object(cleanup, "request")
    def test_hub_requires_current_tag_before_deleting(self, request):
        request.side_effect = [{"access_token": "test"}, {
            "results": [{"name": "develop-abcdef0"}], "next": None,
        }]
        with self.assertRaisesRegex(RuntimeError, "No develop tag"):
            cleanup.cleanup_dockerhub(apply=True)
        self.assertFalse(any(c.kwargs.get("method") == "DELETE" for c in request.call_args_list))

    @patch.object(cleanup, "request")
    def test_hub_rejects_unexpected_pagination_host(self, request):
        request.return_value = {"results": [], "next": "https://other.example/tags/"}
        with self.assertRaisesRegex(RuntimeError, "pagination"):
            cleanup.cleanup_dockerhub()
        self.assertEqual(request.call_count, 1)

    @patch.object(cleanup, "request")
    def test_ghcr_pagination_and_recheck_preserve_new_release_tag(self, request):
        first_page = [version(1, "develop"), version(2, "develop-abcdef0")]
        first_page.extend(version(n) for n in range(3, 101))
        request.side_effect = [first_page, [version(101, "develop-1234567")],
                               version(2, "develop-abcdef0", "2.11.0"),
                               version(101, "develop-1234567"), None]
        cleanup.cleanup_ghcr(apply=True)
        calls = request.call_args_list
        self.assertIn("page=2", calls[1].args[0])
        self.assertEqual([c.args[0] for c in calls if c.kwargs.get("method") == "DELETE"],
                         [cleanup.GHCR + "/101"])

    @patch.object(cleanup, "request")
    def test_ghcr_preview_never_deletes(self, request):
        request.return_value = [version(1, "develop"), version(2, "develop-abcdef0")]
        cleanup.cleanup_ghcr()
        self.assertEqual(request.call_count, 1)
        self.assertNotIn("method", request.call_args.kwargs)

    @patch.object(cleanup, "request")
    def test_ghcr_requires_current_tag(self, request):
        request.return_value = [version(1, "develop-abcdef0")]
        with self.assertRaisesRegex(RuntimeError, "No develop tag"):
            cleanup.cleanup_ghcr(apply=True)
        self.assertEqual(request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
