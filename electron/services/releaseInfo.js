const RELEASES_URL = 'https://github.com/NovaTweaksDev/Nova-Tweaks/releases';
const API_URL = 'https://api.github.com/repos/NovaTweaksDev/Nova-Tweaks/releases?per_page=100';

async function getReleaseInfo(currentVersion, fetchRelease) {
  const notes = { version: currentVersion, releaseStatus: 'unavailable', downloadUrl: RELEASES_URL };
  try {
    const response = await fetchRelease(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return notes;
    const releases = await response.json();
    if (!Array.isArray(releases)) return notes;
    const release = releases.filter((item) => !item.draft && item.tag_name && item.published_at)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
    if (!release) return { ...notes, releaseStatus: 'empty' };
    return {
      ...notes,
      releaseStatus: 'available',
      releaseTag: release.tag_name,
      prerelease: release.prerelease === true,
      downloadUrl: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`
    };
  } catch {
    return notes;
  }
}

module.exports = { getReleaseInfo };
