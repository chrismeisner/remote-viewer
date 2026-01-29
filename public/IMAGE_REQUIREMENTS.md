# Image Requirements for Remote Viewer

Place all these images in the `/public` folder.

## Favicons (Browser Tab Icons)

| Filename | Size | Format | Purpose |
|----------|------|--------|---------|
| `favicon.ico` | 32x32 | ICO | Legacy browsers (move from /src/app to /public) |
| `icon-192.png` | 192x192 | PNG | Modern browsers, Android home screen |
| `icon-512.png` | 512x512 | PNG | PWA, high-res displays |
| `apple-icon.png` | 180x180 | PNG | iOS Safari, Apple devices |

## Social Sharing Image (iMessage, Facebook, Twitter, LinkedIn, etc.)

| Filename | Size | Format | Purpose |
|----------|------|--------|---------|
| `og-image.png` | 1200x630 | PNG or JPG | Open Graph / social preview |

---

## Quick Checklist

After creating your images, your `/public` folder should contain:

```
public/
├── favicon.ico        (32x32)
├── icon-192.png       (192x192)
├── icon-512.png       (512x512)
├── apple-icon.png     (180x180)
├── og-image.png       (1200x630)
└── ... (other existing files)
```

## Design Tips

### Favicon (icon-192.png, icon-512.png, apple-icon.png)
- Use a simple, recognizable icon/logo
- Works well at small sizes
- Square format
- Transparent background works for PNG
- Consider the app name initials "RV" or a TV/remote icon

### Social Image (og-image.png)
- Include your app name "Remote Viewer"
- Brief tagline or visual that represents the app
- Use brand colors
- Keep text large and readable
- Safe zone: keep important content away from edges (some platforms crop)
- Recommended: dark background with light text for TV/video theme

## Testing

After adding images and deploying:

1. **Favicon**: Check browser tab shows your icon
2. **Social sharing**: Use these tools to test:
   - Facebook: https://developers.facebook.com/tools/debug/
   - Twitter: https://cards-dev.twitter.com/validator
   - LinkedIn: https://www.linkedin.com/post-inspector/
   - General: https://www.opengraph.xyz/

3. **iMessage**: Send the URL to yourself to see the preview
