import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Skill } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { SkillPyramid } from '../../components/SkillPyramid.tsx';
import { LiquidAdder } from '../../components/ui/LiquidAdder.tsx';
import { SkillCanvas } from './SkillCanvas.tsx';
import { SKILLS_KEY, useSkills } from './useBoard.ts';
import './skills.css';

const LAST_KEY = 'hub:skill';

/**
 * The skill tracker: the skills along the top (a "+" adds one), and the open skill's canvas below,
 * where it climbs from its foundations, stage by stage.
 */
export function SkillsPage() {
  const queryClient = useQueryClient();
  const skills = useSkills();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs keep the order skills were made in, so they never jump while you work.
  const tabs = useMemo(() => [...(skills.data ?? [])].sort((a, b) => a.id - b.id), [skills.data]);
  const asked = Number(params.get('skill') ?? localStorage.getItem(LAST_KEY) ?? NaN);
  const current: Skill | undefined = tabs.find((s) => s.id === asked) ?? tabs[0];

  useEffect(() => {
    if (current) localStorage.setItem(LAST_KEY, String(current.id));
  }, [current]);

  const open = (id: number) => setParams({ skill: String(id) }, { replace: true });

  const add = async (name: string): Promise<boolean> => {
    setAdding(true);
    setError(null);
    try {
      const skill = await api<Skill>('/api/skills', { method: 'POST', json: { name } });
      await queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
      open(skill.id);
      return true;
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t add that skill — retry');
      return false;
    } finally {
      setAdding(false);
    }
  };

  const remove = async (skill: Skill) => {
    if (!window.confirm(`Delete “${skill.name}” and everything on its canvas?`)) return;
    await api(`/api/skills/${skill.id}`, { method: 'DELETE' });
    localStorage.removeItem(LAST_KEY);
    setParams({}, { replace: true });
    await queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
  };

  return (
    <div className="skills">
      <header className="skills__bar">
        <h1 className="skills__title">Skill tracker</h1>
        <div className="skills__tabs" role="tablist" aria-label="Skills">
          {tabs.map((s) => (
            <button
              key={s.id}
              className="skills__tab"
              type="button"
              role="tab"
              aria-selected={s.id === current?.id}
              onClick={() => open(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <LiquidAdder
          onAdd={add}
          busy={adding}
          addLabel="Add a skill"
          closeLabel="Close the new skill"
          fieldLabel="New skill"
          placeholder="Quantum Computing, Python…"
          width={280}
        />
        {current && (
          <div className="skills__now">
            <SkillPyramid layerSteps={current.layerSteps} stages={current.stages} size={44} label={`${current.name}: ${current.steps} steps`} />
            <button className="skills__delete" type="button" onClick={() => void remove(current)}>
              Delete skill
            </button>
          </div>
        )}
      </header>
      {error !== null && (
        <p className="skills__error" role="alert">
          {error}
        </p>
      )}
      {current ? (
        <SkillCanvas key={current.id} skillId={current.id} />
      ) : skills.isSuccess ? (
        <div className="skills__empty">
          <SkillPyramid layerSteps={[]} stages={3} size={120} label="An empty pyramid" />
          <p>Name what you're mastering with the + above — Quantum Computing, Python — and build it up step by step.</p>
        </div>
      ) : (
        <span aria-busy="true" />
      )}
    </div>
  );
}
