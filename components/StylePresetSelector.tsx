import React from 'react';
import { StyleConfig } from '../types';
import { STYLE_PRESETS, StylePreset } from '../services/stylePresets';
import { Check, Wand2 } from 'lucide-react';

interface StylePresetSelectorProps {
  currentStyle: StyleConfig;
  onSelectPreset: (preset: StylePreset) => void;
}

export const StylePresetSelector: React.FC<StylePresetSelectorProps> = ({
  currentStyle,
  onSelectPreset,
}) => {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        {STYLE_PRESETS.map((preset) => {
          const isSelected =
            currentStyle.presetId === preset.id ||
            (preset.isDefault && (!currentStyle.presetId || currentStyle.presetId === 'preset-1-italic-capsule'));

          return (
            <div
              key={preset.id}
              onClick={() => onSelectPreset(preset)}
              className={`relative group p-4 rounded-2xl border transition-all cursor-pointer text-left ${
                isSelected
                  ? 'bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/40 shadow-lg shadow-emerald-950/40'
                  : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700 hover:bg-slate-850'
              }`}
            >
              {/* Header: Name & Badge */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-display font-black text-white tracking-wide">
                    {preset.name}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md font-mono-code bg-slate-800 text-slate-300 border border-slate-700">
                    {preset.badge}
                  </span>
                </div>

                {isSelected ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    <Check className="w-3 h-3" />
                    <span>Applied</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPreset(preset);
                    }}
                    className="text-[11px] font-bold text-slate-300 hover:text-emerald-400 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-700 transition-all flex items-center gap-1"
                  >
                    <Wand2 className="w-3 h-3" />
                    <span>Use Style</span>
                  </button>
                )}
              </div>

              {/* Live Visual Preview matching Preset Styles */}
              <div className="p-3.5 rounded-xl bg-[#060A12] border border-slate-800 flex flex-col items-center justify-center min-h-[75px] overflow-hidden relative">
                <div
                  className="text-center transition-all"
                  style={{
                    backgroundColor: preset.style.backgroundColor || 'transparent',
                    padding: preset.style.backgroundColor && preset.style.backgroundColor !== 'transparent' ? '6px 14px' : '0px',
                    borderRadius: `${preset.style.cornerRadius || 16}px`,
                  }}
                >
                  {preset.sampleText.split('\n').map((line, idx) => {
                    let textColor = preset.style.textColor || '#FFFFFF';
                    let fontFam = preset.style.fontFamily || 'sans-serif';
                    let textTrans: 'none' | 'uppercase' = preset.style.isUppercase ? 'uppercase' : 'none';
                    let fontSize = '13px';

                    if (preset.id === 'preset-viral' || preset.id === 'preset-6-waxaan-waa-inaad') {
                      if (idx === 0) {
                        textColor = '#000000';
                        fontFam = '"Playfair Display", Georgia, serif';
                        fontSize = '16px';
                      } else if (idx === 1) {
                        textColor = '#0084FF';
                        fontFam = '"Playfair Display", Georgia, serif';
                        fontSize = '13.5px';
                      } else if (idx === 2) {
                        textColor = '#000000';
                        fontFam = '"Outfit", "Plus Jakarta Sans", sans-serif';
                        textTrans = 'uppercase';
                        fontSize = '10px';
                      }
                    } else if (idx === 1 && preset.style.secondaryTextColor) {
                      textColor = preset.style.secondaryTextColor;
                    }

                    if (preset.id === 'preset-karaoke' && idx === 0) {
                      // Highlight second word to simulate karaoke
                      const words = line.split(' ');
                      return (
                        <div
                          key={idx}
                          className="leading-tight select-none tracking-wide flex items-center justify-center gap-1.5"
                          style={{
                            fontFamily: fontFam,
                            fontWeight: preset.style.fontWeight || '800',
                            fontSize,
                          }}
                        >
                          {words.map((w, wIdx) => (
                            <span
                              key={wIdx}
                              style={{
                                color: wIdx === 1 ? (preset.style.highlightColor || '#FFE600') : '#FFFFFF',
                                textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                                transform: wIdx === 1 ? 'scale(1.1)' : 'scale(1)',
                                transition: 'all 0.2s',
                              }}
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      );
                    }

                    const isViral = preset.id === 'preset-viral' || preset.id === 'preset-6-waxaan-waa-inaad';
                    const strokeCol = isViral ? '#FFFFFF' : (preset.style.textStrokeColor || '#000000');

                    return (
                      <div
                        key={idx}
                        className="leading-tight select-none tracking-wide"
                        style={{
                          fontFamily: fontFam,
                          fontWeight: preset.style.fontWeight || '800',
                          fontStyle: preset.style.fontStyle || 'normal',
                          color: textColor,
                          textTransform: textTrans,
                          fontSize,
                          textShadow:
                            preset.style.textStrokeWidth && preset.style.textStrokeWidth >= 4
                              ? `-1.5px -1.5px 0 ${strokeCol}, 1.5px -1.5px 0 ${strokeCol}, -1.5px 1.5px 0 ${strokeCol}, 1.5px 1.5px 0 ${strokeCol}, 0 2px 5px rgba(0,0,0,0.85)`
                              : preset.style.textStrokeWidth && preset.style.textStrokeWidth > 0
                              ? `-1px -1px 0 ${strokeCol}, 1px -1px 0 ${strokeCol}, -1px 1px 0 ${strokeCol}, 1px 1px 0 ${strokeCol}, 0 1px 3px rgba(0,0,0,0.75)`
                              : '0 2px 4px rgba(0,0,0,0.8)',
                        }}
                      >
                        {line}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Card Controls */}
              <div className="mt-3 flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-mono-code text-[10px]">
                  {preset.style.fontFamily} • {preset.style.fontStyle === 'italic' ? 'Italic' : 'Normal'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPreset(preset);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-200 hover:bg-emerald-500 hover:text-slate-950'
                  }`}
                >
                  {isSelected ? '✓ Applied' : 'Use Style'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

