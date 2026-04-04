import { create } from 'zustand';
import type { FileData } from '@/types';

type CenterView = 'code' | 'diff' | 'story';
type DiffScope = 'commit' | 'compare';

interface ExploreState {
  currentIndex: number;
  selectedFile: FileData | null;
  centerView: CenterView;
  sidebarTab: 'commits' | 'files';
  commitOrder: 'asc' | 'desc';
  diffScope: DiffScope;
  diffViewMode: 'unified' | 'split';
  focusMode: boolean;
  aiPanelExpanded: boolean;
  showSettings: boolean;
  showHistoryModal: boolean;
  showBranchMenu: boolean;
  pinnedBaseSha: string | null;

  // Actions
  setCurrentIndex: (index: number) => void;
  setSelectedFile: (file: FileData | null) => void;
  setCenterView: (view: CenterView) => void;
  setSidebarTab: (tab: 'commits' | 'files') => void;
  setCommitOrder: (order: 'asc' | 'desc') => void;
  setDiffScope: (scope: DiffScope) => void;
  setDiffViewMode: (mode: 'unified' | 'split') => void;
  toggleFocusMode: () => void;
  toggleAiPanel: () => void;
  setShowSettings: (show: boolean) => void;
  setShowHistoryModal: (show: boolean) => void;
  setShowBranchMenu: (show: boolean) => void;
  setPinnedBaseSha: (sha: string | null) => void;

  goToCommit: (index: number, totalCommits: number) => void;
  goNext: (totalCommits: number) => void;
  goPrev: () => void;

  /** Reset transient state (for when navigating away from explore) */
  reset: () => void;
}

const initialState = {
  currentIndex: 0,
  selectedFile: null as FileData | null,
  centerView: 'code' as CenterView,
  sidebarTab: 'files' as 'commits' | 'files',
  commitOrder: 'asc' as 'asc' | 'desc',
  diffScope: 'commit' as DiffScope,
  diffViewMode: 'unified' as 'unified' | 'split',
  focusMode: false,
  aiPanelExpanded: true,
  showSettings: false,
  showHistoryModal: false,
  showBranchMenu: false,
  pinnedBaseSha: null as string | null,
};

export const useExploreStore = create<ExploreState>((set) => ({
  ...initialState,

  setCurrentIndex: (index) => set({ currentIndex: index }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setCenterView: (view) => set({ centerView: view }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setCommitOrder: (order) => set({ commitOrder: order }),
  setDiffScope: (scope) => set({ diffScope: scope }),
  setDiffViewMode: (mode) => set({ diffViewMode: mode }),
  toggleFocusMode: () => set(s => ({ focusMode: !s.focusMode })),
  toggleAiPanel: () => set(s => ({ aiPanelExpanded: !s.aiPanelExpanded })),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowHistoryModal: (show) => set({ showHistoryModal: show }),
  setShowBranchMenu: (show) => set({ showBranchMenu: show }),
  setPinnedBaseSha: (sha) => set({ pinnedBaseSha: sha }),

  goToCommit: (index, totalCommits) => {
    if (index < 0 || index >= totalCommits) return;
    set({ currentIndex: index, sidebarTab: 'files' });
  },

  goNext: (totalCommits) => {
    set(s => ({
      currentIndex: totalCommits === 0 ? 0 : Math.min(s.currentIndex + 1, totalCommits - 1),
    }));
  },

  goPrev: () => {
    set(s => ({ currentIndex: Math.max(s.currentIndex - 1, 0) }));
  },

  reset: () => set(initialState),
}));
