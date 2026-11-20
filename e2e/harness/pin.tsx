import { createRoot } from 'react-dom/client';
import { Landing } from '../../src/ui/screens/KidScreens';
import { PinPad } from '../../src/ui/PinPad';
import { FirstScreen } from '../../src/ui/screens/FirstScreen';
import { readTiles } from '../../src/data/deviceTiles';
import '../../src/styles.css';

/**
 * Test-only page. It mounts the real Landing (kid tab) or the real PinPad with a fake sign-in, so the e2e can
 * drive the kid PIN screens without Firebase. ?mode=kid|pad|door&slow=<ms>. PIN 0000 and picture iiii are wrong.
 * mode=door is the two-door first screen (signin2): tiles come from localStorage mathquest:v1:device-tiles, and a username that
 * ends in "pic" gets the picture pad. &view=grownups opens the Google sign-in. A username that starts with "lock" is refused with
 * the rate-limit message, one that starts with "down" with a network failure.
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

async function fakeKind(username: string): Promise<'digits' | 'pictures'> {
  w.__calls.push(`kind:${username}`);
  if (slow) await new Promise((r) => setTimeout(r, slow));
  if (username.startsWith('lock')) throw Object.assign(new Error('Too many tries. Wait a minute and try again.'), { code: 'functions/resource-exhausted' });
  if (username.startsWith('down')) throw new Error('network');
  return username.endsWith('pic') ? 'pictures' : 'digits';
}

const root = createRoot(document.getElementById('root')!);
function rerender() {
  if (q.get('mode') === 'pad') {
    root.render(<PinPad title="Test PIN" error={wrong ? 'Wrong PIN. Try again.' : null} onComplete={(p) => fakeSignIn(p)} />);
    return;
  }
  if (q.get('mode') === 'door') {
    root.render(
      <FirstScreen
        {...(q.get('view') === 'grownups' ? { initialView: 'grownups' as const } : {})}
        error={wrong ? "That username and passcode didn't match." : null}
        tiles={readTiles()}
        kindOf={fakeKind}
        onKidSubmit={(username, code) => fakeSignIn(`${username}:${code}`)}
        onParentSignIn={() => void w.__calls.push('google')}
      />,
    );
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
