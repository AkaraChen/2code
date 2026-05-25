import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

export const appThemeConfig = defineConfig({
  theme: {
    tokens: {
      radii: {
        none: { value: "0" },
        "2xs": { value: "2px" },
        xs: { value: "3px" },
        sm: { value: "4px" },
        md: { value: "6px" },
        lg: { value: "8px" },
        xl: { value: "10px" },
        "2xl": { value: "12px" },
        "3xl": { value: "14px" },
        "4xl": { value: "16px" },
        full: { value: "9999px" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: {
            value: {
              _light: "#f5f5f7",
              _dark: "#1c1c1e",
            },
          },
          subtle: {
            value: {
              _light: "rgba(0, 0, 0, 0.035)",
              _dark: "rgba(255, 255, 255, 0.055)",
            },
          },
          muted: {
            value: {
              _light: "rgba(0, 0, 0, 0.06)",
              _dark: "rgba(255, 255, 255, 0.08)",
            },
          },
          emphasized: {
            value: {
              _light: "rgba(0, 0, 0, 0.1)",
              _dark: "rgba(255, 255, 255, 0.12)",
            },
          },
          panel: {
            value: {
              _light: "{colors.white}",
              _dark: "#1f2023",
            },
          },
        },
        fg: {
          DEFAULT: {
            value: {
              _light: "#1d1d1f",
              _dark: "#f5f5f7",
            },
          },
          muted: {
            value: {
              _light: "rgba(60, 60, 67, 0.72)",
              _dark: "rgba(235, 235, 245, 0.68)",
            },
          },
          subtle: {
            value: {
              _light: "rgba(60, 60, 67, 0.46)",
              _dark: "rgba(235, 235, 245, 0.42)",
            },
          },
        },
        border: {
          DEFAULT: {
            value: {
              _light: "rgba(60, 60, 67, 0.18)",
              _dark: "rgba(235, 235, 245, 0.16)",
            },
          },
          muted: {
            value: {
              _light: "rgba(60, 60, 67, 0.1)",
              _dark: "rgba(235, 235, 245, 0.1)",
            },
          },
          subtle: {
            value: {
              _light: "rgba(60, 60, 67, 0.08)",
              _dark: "rgba(235, 235, 245, 0.08)",
            },
          },
          emphasized: {
            value: {
              _light: "rgba(60, 60, 67, 0.28)",
              _dark: "rgba(235, 235, 245, 0.26)",
            },
          },
        },
      },
      radii: {
        l1: { value: "4px" },
        l2: { value: "5px" },
        l3: { value: "6px" },
      },
    },
  },
});

export const appSystem = createSystem(defaultConfig, appThemeConfig);
