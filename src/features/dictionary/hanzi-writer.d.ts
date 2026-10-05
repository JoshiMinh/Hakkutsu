declare module "hanzi-writer" {
  export interface HanziWriterOptions {
    width?: number;
    height?: number;
    padding?: number;
    showOutline?: boolean;
    strokeAnimationSpeed?: number;
    delayBetweenStrokes?: number;
    charDataLoader?: (char: string, onComplete: (data: any) => void, onError: (err: any) => void) => void;
  }

  export default class HanziWriter {
    static create(element: string | HTMLElement, character: string, options?: HanziWriterOptions): HanziWriter;
    
    animateCharacter(): void;
    loopCharacterAnimation(): void;
    pauseAnimation(): void;
    resumeAnimation(): void;
    hideCharacter(): void;
    showCharacter(): void;
    setCharacter(char: string): void;
    destroy(): void;
  }
}
