import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import './CamPlayer.css'

const STATUS_LABELS = {
  connecting: 'CONNECTING…',
  live: 'LIVE',
  offline: 'OFFLINE',
  unsupported: 'UNSUPPORTED',
}

export function CamStatusIndicator({ status, compact = false }) {
  if (status === 'live') {
    return (
      <span className={`cam-live${compact ? ' cam-live--compact' : ''}`}>
        <span className="cam-live-dot">●</span> LIVE
      </span>
    )
  }
  return <span className="cam-status-text">{STATUS_LABELS[status] ?? STATUS_LABELS.connecting}</span>
}

// Hides the top cropTop% of the source image (burned-in overlay text on some
// cameras) via a uniform zoom + shift, so nothing gets stretched.
function frameStyle(camera) {
  if (!camera.cropTop) {
    return camera.objectPosition ? { objectPosition: camera.objectPosition } : undefined
  }
  const scale = 100 / (100 - camera.cropTop)
  return {
    ...(camera.objectPosition ? { objectPosition: camera.objectPosition } : null),
    transformOrigin: 'top',
    transform: `scale(${scale}) translateY(-${camera.cropTop}%)`,
  }
}

function CamPlayer({ camera, ready = true, active = true, fit = 'contain', className = '', onStateChange }) {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  useEffect(() => {
    if (!ready || !active) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false

    setStatus('connecting')
    onStateChangeRef.current?.({ status: 'connecting', videoWidth: null, videoHeight: null })

    const updateStatus = (next) => {
      // Guards against stale events from a stream/instance this effect has
      // already torn down (e.g. switching cameras via [<]/[>]) — without
      // this, a late error from the OLD stream can flash "OFFLINE" for the
      // NEW one right before its real "LIVE" state lands.
      if (cancelled) return
      setStatus(next)
      onStateChangeRef.current?.({
        status: next,
        videoWidth: video.videoWidth || null,
        videoHeight: video.videoHeight || null,
      })
    }

    const onLoadedMetadata = () => updateStatus('live')
    const onError = () => updateStatus('offline')

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = camera.stream
      video.addEventListener('loadedmetadata', onLoadedMetadata)
      video.addEventListener('error', onError)
      return () => {
        cancelled = true
        video.removeEventListener('loadedmetadata', onLoadedMetadata)
        video.removeEventListener('error', onError)
      }
    }

    if (!Hls.isSupported()) {
      updateStatus('unsupported')
      return
    }

    const hls = new Hls()
    hls.loadSource(camera.stream)
    hls.attachMedia(video)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) updateStatus('offline')
    })

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      hls.destroy()
    }
  }, [ready, active, camera.stream])

  const frameClassName = `cam-frame${className ? ` ${className}` : ''}`
  const mediaClassName = `cam-video${fit === 'cover' ? ' cam-video--cover' : ''}`

  if (!active) {
    return (
      <div className={frameClassName}>
        <img className={mediaClassName} src={camera.poster} alt="" style={frameStyle(camera)} />
        <div className="cam-idle-indicator">
          <span>▶</span>
        </div>
        <div className="cam-scanlines" aria-hidden="true" />
      </div>
    )
  }

  const isLive = status === 'live'
  const posterOverlayClassName = `cam-overlay-poster${fit === 'cover' ? ' cam-overlay-poster--cover' : ''}`

  return (
    <div className={frameClassName}>
      <video
        ref={videoRef}
        className={mediaClassName}
        muted
        autoPlay
        playsInline
        poster={camera.poster}
        style={frameStyle(camera)}
      />
      {!isLive && (
        <div className="cam-overlay">
          <img className={posterOverlayClassName} src={camera.poster} alt="" style={frameStyle(camera)} />
          <div className="cam-overlay-text">
            <span>{'> SIGNAL LOST'}</span>
            <span className="cam-overlay-status">{STATUS_LABELS[status]}</span>
          </div>
        </div>
      )}
      <div className="cam-scanlines" aria-hidden="true" />
    </div>
  )
}

export default CamPlayer
