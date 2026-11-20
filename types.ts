export interface Caption {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface StyleConfig {
  textColor: string;
  secondaryTextColor?: string;
  tier3TextColor?: string;
  tier3FontFamily?: string;
  highlightColor?: string; // For word highlight / karaoke mode
  backgroundColor: string;
  backgroundType?: 'none' | 'solid' | 'transparent' | 'rounded' | 'glass' | 'gradient';
  backgroundOpacity?: number; // 0 to 100
  cornerRadius?: number; // px
  padding?: number; // px
  textStrokeColor: string;
  textStrokeWidth: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  yPosition: number; // Percentage from top (10% - 90%)
  isUppercase?: boolean;
  shadowBlur?: number;
  shadowOpacity?: number;
  animation?: 'none' | 'fade' | 'pop' | 'slide' | 'word-by-word' | 'karaoke' | 'bounce';
  presetId?: string;
  progressiveReveal?: boolean; // When true, lines appear sequentially (Line 1 -> Line 2 -> Line 3)
  aspectRatioPreset?: 'original' | '16:9' | '9:16' | '1:1' | '4:5';
}

export interface VideoTransform {
  rotation: number; // degrees
  filter: string; // css filter string
  scale: number;
}

export enum Tab {
  TEXT = 'Captions',
  STYLE = 'Style',
  TIMELINE = 'Timeline',
  EXPORT = 'Export',
  PROJECTS = 'Projects',
}

export interface SavedProject {
  id: string;
  videoName: string;
  duration?: number;
  captionsCount: number;
  captions: Caption[];
  styleConfig: StyleConfig;
  updatedAt: string;
}

