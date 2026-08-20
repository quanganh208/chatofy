/**
 * The popup's entry point.
 *
 * `consent-gate` is imported for its side effect and stands first: it attaches the
 * recording notice's button before anything else runs, so the notice is
 * dismissible even if the tree below fails to mount.
 */
import './consent-gate';

import { createRoot } from 'react-dom/client';
import { Popup } from './popup';

import './style.css';

const host = document.getElementById('app');
if (host) createRoot(host).render(<Popup />);
