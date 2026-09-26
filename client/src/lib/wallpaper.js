// Shared group wallpaper presets + style helper.
// Server value: null (default) | "preset:<id>" | "upload:<ext>"
export const WALLPAPER_PRESETS = [
  {
    id: 'dots',
    name: 'Default',
    style: {
      backgroundColor: '#0b141a',
      backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
    },
  },
  { id: 'midnight', name: 'Midnight', style: { background: 'linear-gradient(135deg, #0f2027 0%, #203a43 55%, #2c5364 100%)' } },
  { id: 'ocean', name: 'Ocean', style: { background: 'linear-gradient(135deg, #062a44 0%, #0b5a6e 60%, #0e8a8a 100%)' } },
  { id: 'forest', name: 'Forest', style: { background: 'linear-gradient(135deg, #0a2e1a 0%, #175c36 60%, #2a9d5c 100%)' } },
  { id: 'sunset', name: 'Sunset', style: { background: 'linear-gradient(135deg, #2c1245 0%, #8a2a5c 55%, #e0703a 100%)' } },
  { id: 'grape', name: 'Grape', style: { background: 'linear-gradient(135deg, #1d0f3d 0%, #4a2a8a 60%, #7a5cc9 100%)' } },
  { id: 'ember', name: 'Ember', style: { background: 'linear-gradient(135deg, #2a0a05 0%, #7a2410 60%, #c25a1e 100%)' } },
  { id: 'slate', name: 'Slate', style: { backgroundColor: '#111b21' } },
];

export function wallpaperStyle(wallpaper, conversationId) {
  if (!wallpaper) return undefined;
  if (wallpaper.startsWith('preset:')) {
    const p = WALLPAPER_PRESETS.find((x) => x.id === wallpaper.slice(7));
    return p ? p.style : undefined;
  }
  if (wallpaper.startsWith('upload:')) {
    return {
      backgroundImage: `url(/api/conversations/${conversationId}/wallpaper)`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return undefined;
}

export function currentWallpaperId(wallpaper) {
  if (!wallpaper) return 'dots';
  if (wallpaper.startsWith('preset:')) return wallpaper.slice(7);
  if (wallpaper.startsWith('upload:')) return 'upload';
  return 'dots';
}
