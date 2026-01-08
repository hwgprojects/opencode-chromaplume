import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// ============================================================================
// Color Manipulation Helpers
// ============================================================================

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "")
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRGB(hex)
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255

  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  const l = (max + min) / 2

  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case rNorm:
        h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6
        break
      case gNorm:
        h = ((bNorm - rNorm) / d + 2) / 6
        break
      case bNorm:
        h = ((rNorm - gNorm) / d + 4) / 6
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
    b = 0
  } else if (h < 120) {
    r = x
    g = c
    b = 0
  } else if (h < 180) {
    r = 0
    g = c
    b = x
  } else if (h < 240) {
    r = 0
    g = x
    b = c
  } else if (h < 300) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

function lighten(hex: string, amount: number): string {
  const { h, s, l } = hexToHSL(hex)
  const newL = Math.min(100, l + amount * 100)
  return hslToHex(h, s, newL)
}

function darken(hex: string, amount: number): string {
  const { h, s, l } = hexToHSL(hex)
  const newL = Math.max(0, l - amount * 100)
  return hslToHex(h, s, newL)
}

// ============================================================================
// Theme Loading
// ============================================================================

interface ThemeDefs {
  [key: string]: string
}

interface ThemeColors {
  [key: string]: { dark: string; light: string } | string
}

interface ThemeFile {
  $schema?: string
  defs?: ThemeDefs
  theme: ThemeColors
}

async function loadBaseTheme(baseThemeName: string): Promise<ThemeFile | null> {
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const themePath = join(configDir, "opencode", "themes", `${baseThemeName}.json`)

  try {
    const content = await readFile(themePath, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
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

function generatePeacockTheme(
  baseTheme: ThemeFile,
  peacockColor: string
): ThemeFile {
  const peacockLight = lighten(peacockColor, 0.15)
  const peacockDark = darken(peacockColor, 0.15)

  // Merge defs with peacock colors
  const defs: ThemeDefs = {
    ...(baseTheme.defs || {}),
    peacock: peacockColor,
    peacockLight: peacockLight,
    peacockDark: peacockDark,
  }

  // Create theme with peacock overrides
  const theme: ThemeColors = {
    ...baseTheme.theme,
    // Override primary/accent colors with peacock
    primary: { dark: "peacock", light: "peacock" },
    accent: { dark: "peacockLight", light: "peacockLight" },
    secondary: { dark: "peacockDark", light: "peacockDark" },
    borderActive: { dark: "peacock", light: "peacock" },
    // Override markdown elements for visual consistency
    markdownHeading: { dark: "peacock", light: "peacock" },
    markdownLink: { dark: "peacock", light: "peacock" },
    markdownLinkText: { dark: "peacockLight", light: "peacockLight" },
    markdownListItem: { dark: "peacock", light: "peacock" },
  }

  return {
    $schema: "https://opencode.ai/theme.json",
    defs,
    theme,
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
      // Ensure theme is set (in case it existed but was different)
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

/** Default base theme to inherit from */
const DEFAULT_BASE_THEME = "theme-darker"

export const PeacockSyncPlugin: Plugin = async ({ directory, client }) => {
  const log = (message: string, level: "debug" | "info" | "warn" | "error" = "info") => {
    client.app.log({
      service: "peacock-sync",
      level,
      message,
    })
  }

  // Run sync on plugin load
  const syncPeacock = async () => {
    const peacockColor = await getPeacockColor(directory)

    if (!peacockColor) {
      log("No Peacock color found in .vscode/settings.json", "debug")
      return
    }

    const baseTheme = await loadBaseTheme(DEFAULT_BASE_THEME)

    if (!baseTheme) {
      log(`Could not load base theme (${DEFAULT_BASE_THEME}.json) from ~/.config/opencode/themes/`, "warn")
      return
    }

    // Generate the peacock theme
    const peacockTheme = generatePeacockTheme(baseTheme, peacockColor)

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

// Default export for convenience
export default PeacockSyncPlugin
