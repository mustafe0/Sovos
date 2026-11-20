const fs = require('fs');
const { execSync } = require('child_process');

const assContent = `[Script Info]
Title: Test Subtitles
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,42,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,2,1,2,40,40,150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:04.00,Default,,0,0,0,,Kalay nana wadaag muuqaalka maanta\\nWaxaan rajaynayaa inaad ka hesho
`;

fs.writeFileSync('/tmp/test_manual.ass', assContent);

try {
  const out = execSync('ffmpeg -y -i /tmp/sample_video.mp4 -vf "ass=/tmp/test_manual.ass" -c:v libx264 -pix_fmt yuv420p -c:a copy /tmp/test_manual.mp4 2>&1');
  console.log('FFMPEG OUTPUT:', out.toString());
} catch (err) {
  console.error('ERROR:', err.stdout?.toString(), err.stderr?.toString());
}
