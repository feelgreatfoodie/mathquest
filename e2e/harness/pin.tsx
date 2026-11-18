import { createRoot } from 'react-dom/client';
import { Landing } from '../../src/ui/screens/KidScreens';
import { PinPad } from '../../src/ui/PinPad';
import '../../src/styles.css';

/**
 * Test-only page. It mounts the real Landing (kid tab) or the real PinPad with a fake sign-in, so the e2e can
 * drive the kid PIN screens without Firebase. ?mode=kid|pad&slow=<ms>. PIN 0000 and picture iiii are wrong.
 * Every call is recorded on window.__calls.
 */
const q = new URLSearchParams(location.search);
const slow = Number(q.get('slow') ?? 0);
const w = window as unknown as { __calls: string[] };
w.__calls = [];

// The kid-side error text, like App.tsx sets it from a rejected signInKid.
let wrong = false;
async function fakeSignIn(label: string): Promise<boolean> {
  w.__calls.push(label);
  if (slow) await new Promise((r) => setTimeout(r, slow));
  wrong = label.endsWith('0000') || label.endsWith(':iiii');
  rerender();
  return !wrong;
}

const root = createRoot(document.getElementById('root')!);
function rerender() {
  if (q.get('mode') === 'pad') {
    root.render(<PinPad title="Test PIN" error={wrong ? 'Wrong PIN. Try again.' : null} onComplete={(p) => fakeSignIn(p)} />);
    return;
  }
  root.render(
    <Landing
      initialTab="kid"
      error={wrong ? "That name and PIN didn't match" : null}
      onKidSubmit={(name, pin) => fakeSignIn(`${name}:${pin}`)}
      onParentSignIn={() => undefined}
    />,
  );
}
rerender();
