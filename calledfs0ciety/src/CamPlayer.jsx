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

function CamPlayer({ camera, ready = true, onStateChange }) {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  useEffect(() => {
    if (!ready) return
    const video = videoRef.current
    if (!video) return

    setStatus('connecting')
    onStateChangeRef.current?.({ status: 'connecting', videoWidth: null, videoHeight: null })

    const updateStatus = (next) => {
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
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      hls.destroy()
    }
  }, [ready, camera.stream])

  const isLive = status === 'live'

  return (
    <div className="cam-frame">
      <video
        ref={videoRef}
        className="cam-video"
        muted
        autoPlay
        playsInline
        poster={camera.poster}
        style={camera.objectPosition ? { objectPosition: camera.objectPosition } : undefined}
      />
      {!isLive && (
        <div className="cam-overlay">
          <img
            className="cam-overlay-poster"
            src={camera.poster}
            alt=""
            style={camera.objectPosition ? { objectPosition: camera.objectPosition } : undefined}
          />
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
