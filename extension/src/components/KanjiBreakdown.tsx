import React, { useEffect, useRef, useState } from "react"
import HanziWriter from "hanzi-writer"

interface KanjiBreakdownProps {
  kanji: string;
}

interface KanjiData {
  kanji: string;
  grade: number | null;
  stroke_count: number;
  meanings: string[];
  kun_readings: string[];
  on_readings: string[];
  name_readings: string[];
  jlpt: number | null;
  unicode: string;
  heisig_en: string | null;
}

export const KanjiBreakdown: React.FC<KanjiBreakdownProps> = ({ kanji }) => {
  const [data, setData] = useState<KanjiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const writerRef = useRef<HTMLDivElement>(null)
  const writerInstance = useRef<HanziWriter | null>(null)

  useEffect(() => {
    let isMounted = true

    const fetchKanjiData = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`https://kanjiapi.dev/v1/kanji/${kanji}`)
        if (!response.ok) {
          throw new Error("Kanji not found in dictionary")
        }
        const json = await response.json()
        if (isMounted) {
          setData(json)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load kanji data")
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchKanjiData()

    return () => {
      isMounted = false
    }
  }, [kanji])

  useEffect(() => {
    if (!writerRef.current) return

    // Clean up previous instance
    if (writerInstance.current) {
      writerInstance.current.destroy()
    }

    writerInstance.current = HanziWriter.create(writerRef.current, kanji, {
      width: 100,
      height: 100,
      padding: 5,
      showOutline: true,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 50,
      // Use Japanese kanji data if available, fallback to default
      charDataLoader: (char, onComplete, onError) => {
        // Attempt to load from a third-party kanji json dataset compatible with hanzi-writer
        fetch(`https://cdn.jsdelivr.net/npm/kanji-writer-data-jp@1.0.0/${char}.json`)
          .then(res => {
            if (!res.ok) throw new Error("Not found")
            return res.json()
          })
          .then(onComplete)
          .catch(() => {
            // Fallback to default hanzi writer data
            fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${char}.json`)
              .then(res => res.json())
              .then(onComplete)
              .catch(onError)
          })
      }
    })

    return () => {
      if (writerInstance.current) {
        writerInstance.current.destroy()
        writerInstance.current = null
      }
    }
  }, [kanji])

  const handleAnimate = () => {
    if (writerInstance.current) {
      writerInstance.current.animateCharacter()
    }
  }

  if (loading) return <div className="hk-kanji-loading">Loading kanji info...</div>
  if (error) return <div className="hk-kanji-error">{error}</div>
  if (!data) return null

  return (
    <div className="hk-kanji-breakdown">
      <div className="hk-kanji-header">
        <div 
          className="hk-kanji-writer" 
          ref={writerRef} 
          onClick={handleAnimate}
          title="Click to animate stroke order"
        ></div>
        <div className="hakkutsu-kanji-stats">
          {data.jlpt && <span className={`hakkutsu-jlpt-badge jlpt-n${data.jlpt}`}>N{data.jlpt}</span>}
          <span className="hakkutsu-kanji-strokes">{data.stroke_count} strokes</span>
        </div>
      </div>
      
      <div className="hakkutsu-kanji-details">
        <div className="hakkutsu-kanji-meanings">
          <strong>Meanings: </strong> {data.meanings.join(", ")}
        </div>
        
        {data.kun_readings.length > 0 && (
          <div className="hakkutsu-kanji-reading">
            <strong>Kun: </strong> {data.kun_readings.join(", ")}
          </div>
        )}
        
        {data.on_readings.length > 0 && (
          <div className="hakkutsu-kanji-reading">
            <strong>On: </strong> {data.on_readings.join(", ")}
          </div>
        )}
      </div>
    </div>
  )
}
