import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

export const appThemeConfig = defineConfig({
  theme: {
    tokens: {
      radii: {
        none: { value: "0" },
        "2xs": { value: "0" },
        xs: { value: "0" },
        sm: { value: "0" },
        md: { value: "0" },
        lg: { value: "0" },
        xl: { value: "0" },
        "2xl": { value: "0" },
        "3xl": { value: "0" },
        "4xl": { value: "0" },
        full: { value: "0" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: {
            value: {
              _light: "{colors.white}",
              _dark: "{colors.gray.900}",
            },
          },
          subtle: {
            value: {
              _light: "{colors.gray.50}",
              _dark: "#1d1e22",
            },
          },
          muted: {
            value: {
              _light: "{colors.gray.100}",
              _dark: "#24262b",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.gray.200}",
              _dark: "{colors.gray.700}",
            },
          },
          panel: {
            value: {
              _light: "{colors.white}",
              _dark: "#1b1c20",
            },
          },
        },
        fg: {
          DEFAULT: {
            value: {
              _light: "{colors.black}",
              _dark: "{colors.gray.100}",
            },
          },
          muted: {
            value: {
              _light: "{colors.gray.600}",
              _dark: "{colors.gray.400}",
            },
          },
          subtle: {
            value: {
              _light: "{colors.gray.400}",
              _dark: "{colors.gray.500}",
            },
          },
        },
        border: {
          DEFAULT: {
            value: {
              _light: "{colors.gray.200}",
              _dark: "{colors.gray.800}",
            },
          },
          muted: {
            value: {
              _light: "{colors.gray.100}",
              _dark: "#202126",
            },
          },
          subtle: {
            value: {
              _light: "{colors.gray.50}",
              _dark: "#191a1d",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.gray.300}",
              _dark: "{colors.gray.600}",
            },
          },
        },
      },
      radii: {
        l1: { value: "0" },
        l2: { value: "0" },
        l3: { value: "0" },
      },
    },
  },
});

export const appSystem = createSystem(defaultConfig, appThemeConfig);
