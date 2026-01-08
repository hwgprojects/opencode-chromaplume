import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

// ============================================================================
// Color Manipulation Helpers
// ============================================================================

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace("#", "")
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100
  const lNorm = l / 100

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNorm - c / 2

  let r = 0,
    g = 0,
    b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0")

  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`
}

function lighten(hex: string, amount: number): string {
  const { h, s, l } = hexToHSL(hex)
  return hslToHex(h, s, Math.min(100, l + amount * 100))
}

function darken(hex: string, amount: number): string {
  const { h, s, l } = hexToHSL(hex)
  return hslToHex(h, s, Math.max(0, l - amount * 100))
}

// ============================================================================
// Peacock Detection
// ============================================================================

interface VSCodeSettings {
  "peacock.color"?: string
  "peacock.remoteColor"?: string
  [key: string]: unknown
}

async function getPeacockColor(directory: string): Promise<string | null> {
  const settingsPath = join(directory, ".vscode", "settings.json")

  try {
    const content = await readFile(settingsPath, "utf-8")
    const settings: VSCodeSettings = JSON.parse(content)
    return settings["peacock.color"] || settings["peacock.remoteColor"] || null
  } catch {
    return null
  }
}

// ============================================================================
// Theme Generation
// ============================================================================

interface ThemeFile {
  $schema: string
  defs: { [key: string]: string }
  theme: { [key: string]: { dark: string; light: string } }
}

function generatePeacockTheme(peacockColor: string): ThemeFile {
  const peacockLight = lighten(peacockColor, 0.15)
  const peacockDark = darken(peacockColor, 0.15)

  // Generate a minimal theme that only overrides accent-related colors
  // OpenCode will use its default theme for everything else
  return {
    $schema: "https://opencode.ai/theme.json",
    defs: {
      peacock: peacockColor,
      peacockLight: peacockLight,
      peacockDark: peacockDark,
    },
    theme: {
      // Primary accent colors
      primary: { dark: "peacock", light: "peacock" },
      accent: { dark: "peacockLight", light: "peacockDark" },
      secondary: { dark: "peacockDark", light: "peacockLight" },
      
      // Active border uses peacock color
      borderActive: { dark: "peacock", light: "peacock" },
      
      // Markdown elements for visual consistency
      markdownHeading: { dark: "peacock", light: "peacock" },
      markdownLink: { dark: "peacock", light: "peacock" },
      markdownLinkText: { dark: "peacockLight", light: "peacockDark" },
      markdownListItem: { dark: "peacock", light: "peacock" },
    },
  }
}

// ============================================================================
// Config Management
// ============================================================================

async function ensureProjectConfig(
  directory: string,
  themeName: string
): Promise<void> {
  const configPath = join(directory, "opencode.json")

  try {
    let config: { theme?: string; [key: string]: unknown } = {}

    if (existsSync(configPath)) {
      const content = await readFile(configPath, "utf-8")
      config = JSON.parse(content)
    }

    // Only update if theme is not already set to peacock
    if (config.theme !== themeName) {
      config = {
        $schema: "https://opencode.ai/config.json",
        theme: themeName,
        ...config,
      }
      config.theme = themeName

      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n")
    }
  } catch {
    // If we can't read/write the config, just skip
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

export const PeacockSyncPlugin: Plugin = async ({ directory, client }) => {
  const log = (message: string) => {
    client.app.log({
      service: "peacock-sync",
      level: "info",
      message,
    })
  }

  const syncPeacock = async () => {
    const peacockColor = await getPeacockColor(directory)

    if (!peacockColor) {
      return // No Peacock color found, nothing to do
    }

    // Generate minimal peacock theme (no base theme needed)
    const peacockTheme = generatePeacockTheme(peacockColor)

    // Write to project's .opencode/themes/
    const themesDir = join(directory, ".opencode", "themes")
    const themePath = join(themesDir, "peacock.json")

    await mkdir(themesDir, { recursive: true })
    await writeFile(themePath, JSON.stringify(peacockTheme, null, 2) + "\n")

    // Ensure project config uses peacock theme
    await ensureProjectConfig(directory, "peacock")

    log(`Generated peacock theme with accent: ${peacockColor}`)
  }

  // Run immediately on startup
  await syncPeacock()

  // Also run when a session is created (in case cwd changed)
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        await syncPeacock()
      }
    },
  }
}

export default PeacockSyncPlugin
