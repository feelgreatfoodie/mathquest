import { createRoot } from 'react-dom/client';
import { Keypad } from '../../src/ui/Keypad';
import { NumberPad } from '../../src/ui/early/NumberPad';
import { PicturePad } from '../../src/ui/early/PicturePad';
import { PinPad } from '../../src/ui/PinPad';
import '../../src/styles.css';

/**
 * Test-only page. It mounts one real keypad: ?pad=keypad (reader, with Go), numpad (picture-player answer grid),
 * pin (PIN pad) or picture (picture PIN pad). The in-game panels (Dungeon, lairs, bosses, Adventure) render these same components.
 */
const pad = new URLSearchParams(location.search).get('pad');
const noop = () => undefined;
const root = createRoot(document.getElementById('root')!);
if (pad === 'numpad') root.render(<div className="screen"><NumberPad max={10} value={7} disabled={false} onKey={noop} onClear={noop} onOk={noop} /></div>);
else if (pad === 'pin') root.render(<PinPad title="Test PIN" onComplete={noop} />);
else if (pad === 'picture') root.render(<div className="screen center"><PicturePad onComplete={noop} onCancel={noop} /></div>);
else root.render(<div className="screen"><Keypad onDigit={noop} onBack={noop} onSubmit={noop} canSubmit /></div>);
