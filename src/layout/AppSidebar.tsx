import "@fontsource-variable/bricolage-grotesque";
import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { LayoutGroup } from "motion/react";
import { useCallback, useRef } from "react";
import { FiHome, FiPlus, FiSettings } from "react-icons/fi";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import { useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { SidebarLink } from "@/shared/components/SidebarLink";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProjectMenuItem } from "./sidebar/ProjectMenuItem";

export default function AppSidebar() {
  const { data: projects } = useProjects();
  const createDialog = useDialogState();
  const navRef = useRef<HTMLElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

    const nav = navRef.current;
    if (!nav) return;

    const items = Array.from(
      nav.querySelectorAll<HTMLElement>("[data-sidebar-item]"),
    );
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    let nextIndex: number;
    if (e.key === "ArrowDown") {
      nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
    } else {
      nextIndex =
        currentIndex === -1
          ? items.length - 1
          : (currentIndex - 1 + items.length) % items.length;
    }

    items[nextIndex]?.focus();
    e.preventDefault();
  }, []);

  return (
    <>
      <Box
        as="nav"
        ref={navRef}
        aria-label={m.sideNavLabel()}
        w="var(--sidebar-width)"
        flexShrink={0}
        bg="bg.subtle"
        onKeyDown={handleKeyDown}
      >
        <LayoutGroup id="app-sidebar">
          <Flex direction="column" h="full" pb="3">
            <Flex
              data-tauri-drag-region
              h="48px"
              flexShrink={0}
              align="center"
              justify="start"
              paddingInline="4"
              mt="8"
            >
              <Text
                fontFamily="'Bricolage Grotesque Variable', sans-serif"
                fontWeight="700"
                color="fg.muted"
                letterSpacing="tight"
                userSelect="none"
                pointerEvents="none"
              >
                2Code
              </Text>
            </Flex>
            {projects.length === 0 && (
              <SidebarLink
                to="/"
                icon={<FiHome />}
                style={{ marginBottom: 20 }}
              >
                {m.home()}
              </SidebarLink>
            )}

            <HStack px="4" pt="2" pb="2" justify="space-between">
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="wider"
              >
                {m.projects()}
              </Text>
              <IconButton
                id="add-project-button"
                aria-label={m.newProject()}
                variant="ghost"
                size="2xs"
                onClick={createDialog.onOpen}
              >
                <FiPlus />
              </IconButton>
            </HStack>

            {projects.map((project) => (
              <ProjectMenuItem key={project.id} project={project} />
            ))}

            <Box flex="1" />

            <SidebarLink
              to="/settings"
              icon={<FiSettings />}
            >
              {m.settings()}
            </SidebarLink>
          </Flex>
        </LayoutGroup>
      </Box>
      <CreateProjectDialog
        isOpen={createDialog.isOpen}
        onClose={createDialog.onClose}
      />
    </>
  );
}
