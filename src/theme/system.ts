import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const appThemeConfig = defineConfig({
  theme: {
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
    },
  },
});

export const appSystem = createSystem(defaultConfig, appThemeConfig);
