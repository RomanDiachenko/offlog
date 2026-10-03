# Offlog — Roadmap

**Open, needed and doable. Nothing else.**

There are only two kinds of open work: what is ours to do, and what is waiting on someone
else. Those are the two sections below. There is no "later" bucket — a maybe
is not work, and keeping one here only grows the file.

Everything closed lives elsewhere, and is not repeated here:

| what | where |
|---|---|
| Why a choice was made, reversed, or refused | [decisions.md](decisions.md) |
| What happened, and old item ids (B39, C4…) | [archive/history.md](archive/history.md) |
| What shipped | [changelog.md](changelog.md) |
| When the next maintenance pass is due | [maintenance.md](maintenance.md) |

**This file is meant to shrink.** An entry that stops being actionable moves
out — closed to decisions.md, parked to archive/history.md. A section with
nothing in it stays that way until real use puts something there.

State as of 4 Oct 2026.

---

## Waiting on someone else

- **C3, Play Store listing.** Release signing is wired into CI
  (`release.yml` writes `keystore.properties` from repo secrets) and the
  privacy policy is [privacy.md](privacy.md). Waiting on Google's identity
  verification and review. Whether local-network sync draws extra review
  friction is an open question in decisions.md. Before submitting, the
  listing draft and its screenshots (kept outside the repo, in the
  git-ignored `brand kit/`) were redone on 3 Oct 2026 for the redesigned
  phone app, with a `play-ready/` set at the 2:1 ratio Play requires.

## Ours to do

- **Release process review.** Each release still repeats hand work: the
  changelog and release notes written separately from the same commits,
  the changelog's keep-10 rotation and link list kept by hand, checks run
  locally and again in CI, and a manual Publish followed by a manual
  Website run before offlog.io shows the new version. Start with an
  analysis of CLAUDE.md's Release steps, `scripts/version.js`,
  `release.yml`, `pages.yml` and `.github/scripts/`, then the owner
  picks what to change.
- **Windows installer polish.** Review the NSIS installer end to end
  (pages, wording, artwork, the uninstaller) against brand.md, the same
  way the phone app was reviewed.