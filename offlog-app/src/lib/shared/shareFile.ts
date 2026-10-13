// Android: hand a file to the share sheet through the app's cache.
// Every shared file goes in one folder that is emptied before the next share.
// A backup or CSV is the whole task list in plain text, so copies must not
// pile up; deleting right after Share resolves instead would break a receiving
// app that reads the file later, so only the latest one stays behind.
// The folder sits under file_paths.xml's cache-path root.
const SHARE_DIR = 'share';

export async function shareViaCache(filename: string, data: string, utf8: boolean): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  await Filesystem.rmdir({ path: SHARE_DIR, directory: Directory.Cache, recursive: true }).catch(() => {});
  const written = await Filesystem.writeFile({
    path: `${SHARE_DIR}/${filename}`,
    data,
    directory: Directory.Cache,
    recursive: true,
    // No `encoding` means base64 data is written as bytes rather than text.
    ...(utf8 ? { encoding: Encoding.UTF8 } : {}),
  });
  await Share.share({ title: filename, url: written.uri });
}
