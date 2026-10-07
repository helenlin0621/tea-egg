"""防劇透外洩檢查。pre-commit、commit-msg 與手動執行共用。

用法：
  py scripts/check_repo.py --staged      檢查暫存區（pre-commit）
  py scripts/check_repo.py --msg FILE    檢查 commit 訊息（commit-msg）
  py scripts/check_repo.py --all         檢查所有已追蹤檔案、歷史訊息、分支名

禁止字詞來自本機的 spoilers.source.json（不在 repo 裡）；檔案不存在時只做檔名檢查。
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "spoilers.source.json"
NEVER_TRACK = ("tea-egg-design.md", "spoilers.source.json")
NEVER_TRACK_DIRS = ("art-source/", "art-build/", "docs/superpowers/")
NEVER_TRACK_EXT = (".png",)
# 編碼後的劇透檔本身不掃（內容是 base64）
SKIP_CONTENT = ("hooks/spoilers.ts",)


def git(*args, binary=False):
    out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace")


def load_guard():
    if not SOURCE.exists():
        return [], []
    guard = json.loads(SOURCE.read_text("utf-8")).get("guard", {})
    words = [w.lower() for w in guard.get("words", [])]
    patterns = [re.compile(p) for p in guard.get("patterns", [])]
    return words, patterns


def scan_text(label, text, words, patterns):
    problems = []
    low = text.lower()
    for w in words:
        if w in low:
            problems.append(f"{label}: 含禁止字詞（{len(w)} 字）")
    for p in patterns:
        if p.search(text):
            problems.append(f"{label}: 含禁止日期格式")
    return problems


def bad_path(path):
    return (
        path in NEVER_TRACK
        or path.startswith(NEVER_TRACK_DIRS)
        or path.lower().endswith(NEVER_TRACK_EXT)
    )


def check_files(paths, read, words, patterns):
    problems = []
    for path in paths:
        if bad_path(path):
            problems.append(f"{path}: 這個檔案不可進 repo")
            continue
        problems += scan_text(f"{path}（檔名）", path, words, patterns)
        if path in SKIP_CONTENT:
            continue
        data = read(path)
        if b"\0" in data[:4096]:
            continue
        problems += scan_text(path, data.decode("utf-8", "replace"), words, patterns)
    return problems


def main(argv):
    words, patterns = load_guard()
    mode = argv[1] if len(argv) > 1 else "--all"
    if mode == "--staged":
        paths = [p for p in git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines() if p]
        problems = check_files(paths, lambda p: git("show", f":{p}", binary=True), words, patterns)
    elif mode == "--msg":
        text = pathlib.Path(argv[2]).read_text("utf-8")
        problems = scan_text("commit 訊息", text, words, patterns)
    elif mode == "--all":
        paths = [p for p in git("ls-files").splitlines() if p]
        problems = check_files(paths, lambda p: (ROOT / p).read_bytes(), words, patterns)
        problems += scan_text("commit 歷史訊息", git("log", "--all", "--format=%B"), words, patterns)
        problems += scan_text("分支名稱", git("branch", "-a", "--format=%(refname)"), words, patterns)
    else:
        print(__doc__)
        return 2
    if not words:
        print("（提醒：找不到 spoilers.source.json，只檢查了檔名規則）")
    for line in problems:
        print("✗", line)
    if problems:
        print("劇透檢查沒過：請修正後再 commit。")
        return 1
    print("✓ 劇透檢查通過")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
