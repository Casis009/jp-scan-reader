import { NavLink } from 'react-router-dom'
import { ScanPicker } from './ScanPicker'

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end>
        <span className="icon">⌂</span>홈
      </NavLink>
      <NavLink to="/vocab">
        <span className="icon">✎</span>단어장
      </NavLink>
      <ScanPicker
        render={(open) => (
          <button className="scan-fab" aria-label="스캔" onClick={() => open('camera')}>
            ◉
          </button>
        )}
      />
      <NavLink to="/settings">
        <span className="icon">⚙</span>설정
      </NavLink>
    </nav>
  )
}
