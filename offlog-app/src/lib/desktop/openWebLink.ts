import { isTauri, invokeTauri } from '../../config';
import { showError } from '../store';

// A link from a task's notes. In the Windows app the native side opens it in
// the default browser and refuses anything but an http(s) address.
export async function openWebLink(url: string): Promise<void> {
  try {
    if (isTauri()) await invokeTauri('open_web_link', { url });
    else window.open(url, '_blank', 'noopener');
  } catch {
    showError('Could not open the link. Please try again.');
  }
}
