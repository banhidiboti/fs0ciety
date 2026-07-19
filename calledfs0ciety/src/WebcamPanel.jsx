import { useEffect, useState } from 'react'
import CamPlayer, { CamStatusIndicator } from './CamPlayer.jsx'
import './WebcamPanel.css'

const CAMERAS = [
  {
    id: 'thuthu',
    label: 'CAM_01 :: BUDAPEST',
    shortLabel: 'CAM_01',
    stream: 'https://cam.idokep.hu/live/thuthu/live-300918a100.m3u8',
    poster: 'https://cam.idokep.hu/cam/thuthu/thumbnail.jpg',
  },
  {
    id: 'hotelvictoria',
    label: 'CAM_02 :: BUDAPEST',
    shortLabel: 'CAM_02',
    stream: 'https://cam.idokep.hu/live/hotelvictoria/live-0020520885.m3u8',
    poster: 'https://cam.idokep.hu/cam/hotelvictoria/thumbnail.jpg',
  },
  {
    id: 'budapestpark',
    label: 'CAM_03 :: BUDAPEST',
    shortLabel: 'CAM_03',
    stream: 'https://cam.idokep.hu/live/budapestpark/live-c995f18840.m3u8',
    poster: 'https://cam.idokep.hu/cam/budapestpark/thumbnail.jpg',
  },
  {
    id: 'schonherz1',
    label: 'CAM_04 :: BUDAPEST',
    shortLabel: 'CAM_04',
    stream: 'https://cam.idokep.hu/live/schonherz1/live-c57fd0cbbe.m3u8',
    poster: 'https://cam.idokep.hu/cam/schonherz1/thumbnail.jpg',
  },
]

function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function streamHost(url) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function WebcamPanel({ ready }) {
  const [view, setView] = useState('panel')
  const [activeIndex, setActiveIndex] = useState(0)
  const [camStates, setCamStates] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)

  const activeCamera = CAMERAS[activeIndex]
  const activeState = camStates[activeCamera.id] ?? { status: 'connecting' }

  const goPrev = () => setActiveIndex((i) => (i - 1 + CAMERAS.length) % CAMERAS.length)
  const goNext = () => setActiveIndex((i) => (i + 1) % CAMERAS.length)

  const handleCamState = (camId, state) => {
    setCamStates((prev) => ({ ...prev, [camId]: state }))
    setLastUpdate(new Date())
  }

  useEffect(() => {
    if (view === 'panel') return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      setView((v) => (v === 'fullscreen' ? 'grid' : 'panel'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

  useEffect(() => {
    if (view === 'panel') return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [view])

  const openGrid = () => setView('grid')
  const closeGrid = () => setView('panel')
  const openFullscreen = (index) => {
    setActiveIndex(index)
    setView('fullscreen')
  }
  const backToGrid = () => setView('grid')

  const resolution =
    activeState.videoWidth && activeState.videoHeight
      ? `${activeState.videoWidth}x${activeState.videoHeight}`
      : '—'

  return (
    <section className="cam-panel">
      <div className="cam-header">
        <div className="cam-title-group">
          <button
            type="button"
            className="cam-nav-btn"
            aria-label="previous camera"
            onClick={goPrev}
          >
            [&lt;]
          </button>
          <span className="cam-title">{`> ${activeCamera.shortLabel}`}</span>
          <button type="button" className="cam-nav-btn" aria-label="next camera" onClick={goNext}>
            [&gt;]
          </button>
        </div>
        <CamStatusIndicator status={activeState.status} />
      </div>

      <button
        type="button"
        className="cam-frame-trigger"
        aria-label="open camera grid view"
        onClick={openGrid}
      >
        <CamPlayer
          camera={activeCamera}
          ready={ready}
          onStateChange={(state) => handleCamState(activeCamera.id, state)}
        />
      </button>

      <div className="cam-footer">
        <span>{`> stream: hls · cam ${activeIndex + 1}/${CAMERAS.length}`}</span>
        {lastUpdate && <span>last checked: {formatClock(lastUpdate)}</span>}
      </div>

      {view !== 'panel' && (
        <div className="cam-overlay-root">
          {view === 'grid' && (
            <div className="cam-grid-overlay">
              <div className="cam-grid-header">
                <span className="cam-title">{'> CAMERA GRID'}</span>
                <button type="button" className="cam-nav-btn cam-close-btn" onClick={closeGrid}>
                  [x] close
                </button>
              </div>
              <div className="cam-grid">
                {CAMERAS.map((cam, i) => {
                  const state = camStates[cam.id] ?? { status: 'connecting' }
                  return (
                    <button
                      key={cam.id}
                      type="button"
                      className="cam-grid-item"
                      aria-label={`open ${cam.label} fullscreen`}
                      onClick={() => openFullscreen(i)}
                    >
                      <CamPlayer
                        camera={cam}
                        onStateChange={(s) => handleCamState(cam.id, s)}
                      />
                      <div className="cam-grid-item-footer">
                        <span className="cam-grid-item-label">{cam.label}</span>
                        <CamStatusIndicator status={state.status} compact />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'fullscreen' && (
            <div className="cam-fullscreen-overlay">
              <div className="cam-fs-header">
                <div className="cam-title-group">
                  <button
                    type="button"
                    className="cam-nav-btn"
                    aria-label="previous camera"
                    onClick={goPrev}
                  >
                    [&lt;]
                  </button>
                  <span className="cam-title">{`> ${activeCamera.label}`}</span>
                  <button
                    type="button"
                    className="cam-nav-btn"
                    aria-label="next camera"
                    onClick={goNext}
                  >
                    [&gt;]
                  </button>
                </div>
                <div className="cam-fs-header-right">
                  <CamStatusIndicator status={activeState.status} />
                  <button type="button" className="cam-nav-btn cam-close-btn" onClick={backToGrid}>
                    [x] close
                  </button>
                </div>
              </div>

              <div className="cam-fs-video-wrap">
                <CamPlayer
                  camera={activeCamera}
                  onStateChange={(state) => handleCamState(activeCamera.id, state)}
                />
              </div>

              <div className="cam-fs-info">
                <div className="cam-line">{`> id: ${activeCamera.id}`}</div>
                <div className="cam-line">{`> source: ${streamHost(activeCamera.stream)}`}</div>
                <div className="cam-line">{'> protocol: hls (m3u8)'}</div>
                <div className="cam-line">{`> resolution: ${resolution}`}</div>
                <div className="cam-line cam-line--dim">
                  {`> last checked: ${lastUpdate ? formatClock(lastUpdate) : '—'}`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default WebcamPanel
