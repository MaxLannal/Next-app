import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Skill, SkillBoard, SkillLink, SkillNode } from '@shared/types.ts';
import { api } from '../../api.ts';

export const SKILLS_KEY = ['skills'];
const boardKey = (id: number) => ['skill', id];

export function useSkills() {
  return useQuery({ queryKey: SKILLS_KEY, queryFn: ({ signal }) => api<Skill[]>('/api/skills', { signal }) });
}

export function useBoard(skillId: number) {
  return useQuery({ queryKey: boardKey(skillId), queryFn: ({ signal }) => api<SkillBoard>(`/api/skills/${skillId}`, { signal }) });
}

type NodeInput = { kind: 'step' | 'experience'; title?: string; description?: string; sessionId?: number; completedOn?: string; layer: number; x: number; y: number };
type NodeEdit = Partial<Pick<SkillNode, 'title' | 'description' | 'layer' | 'x' | 'y' | 'w' | 'h' | 'completedOn'>>;

/**
 * Every write to a board, each keeping the cached board in step with the hub and refreshing the
 * skills list (its counts feed the dashboard's pyramid).
 */
export function useBoardActions(skillId: number) {
  const queryClient = useQueryClient();
  const patchBoard = (update: (b: SkillBoard) => SkillBoard) =>
    queryClient.setQueryData<SkillBoard>(boardKey(skillId), (b) => (b ? update(b) : b));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
    void queryClient.invalidateQueries({ queryKey: boardKey(skillId) });
  };

  return {
    async addNode(input: NodeInput): Promise<SkillNode> {
      const node = await api<SkillNode>(`/api/skills/${skillId}/nodes`, { method: 'POST', json: input });
      patchBoard((b) => ({ ...b, nodes: [...b.nodes, node] }));
      refresh();
      return node;
    },
    async editNode(id: number, edit: NodeEdit): Promise<void> {
      patchBoard((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === id ? { ...n, ...edit } : n)) }));
      await api<SkillNode>(`/api/skills/nodes/${id}`, { method: 'PATCH', json: edit });
      if (edit.layer !== undefined) refresh();
    },
    async removeNode(id: number): Promise<void> {
      patchBoard((b) => ({
        ...b,
        nodes: b.nodes.filter((n) => n.id !== id),
        links: b.links.filter((l) => l.stepId !== id && l.experienceId !== id),
      }));
      await api(`/api/skills/nodes/${id}`, { method: 'DELETE' });
      refresh();
    },
    async link(stepId: number, experienceId: number): Promise<SkillLink> {
      const link = await api<SkillLink>('/api/skills/links', { method: 'POST', json: { stepId, experienceId } });
      patchBoard((b) => (b.links.some((l) => l.id === link.id) ? b : { ...b, links: [...b.links, link] }));
      return link;
    },
    /** Names a stage; a blank name clears it. */
    async nameStage(layer: number, name: string): Promise<void> {
      patchBoard((b) => {
        const stageNames = { ...b.skill.stageNames };
        if (name.trim()) stageNames[layer] = name.trim();
        else delete stageNames[layer];
        return { ...b, skill: { ...b.skill, stageNames } };
      });
      await api<Skill>(`/api/skills/${skillId}/stages/${layer}`, { method: 'PUT', json: { name } });
      void queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
    },
    /** Attaches resources from the Resources panel to an experience, one after another. */
    async attachResources(nodeId: number, resourceIds: number[]): Promise<void> {
      for (const resourceId of resourceIds) {
        const node = await api<SkillNode>(`/api/skills/nodes/${nodeId}/resources`, { method: 'POST', json: { resourceId } });
        patchBoard((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId ? node : n)) }));
      }
    },
    async detachResource(nodeId: number, resourceId: number): Promise<void> {
      patchBoard((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, resources: n.resources.filter((r) => r.id !== resourceId) } : n)),
      }));
      await api(`/api/skills/nodes/${nodeId}/resources/${resourceId}`, { method: 'DELETE' });
    },
    async unlink(id: number): Promise<void> {
      patchBoard((b) => ({ ...b, links: b.links.filter((l) => l.id !== id) }));
      await api(`/api/skills/links/${id}`, { method: 'DELETE' });
    },
  };
}
