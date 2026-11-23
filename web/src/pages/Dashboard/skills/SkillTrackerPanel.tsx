import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { Skill } from '@shared/types.ts';
import { api } from '../../../api.ts';
import { SkillPyramid } from '../../../components/SkillPyramid.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import './skills.css';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The skill you touched last, as a pyramid you are climbing: the foundations compiled at the
 * bottom, the stage you're in glowing, the next one waiting on top. Opens the skill tracker.
 */
export function SkillTrackerPanel() {
  const skills = useQuery({ queryKey: ['skills'], queryFn: ({ signal }) => api<Skill[]>('/api/skills', { signal }) });
  const skill = skills.data?.[0] ?? null;

  return (
    <Panel title="Skill tracker" className="skilltile">
      {skills.isSuccess && skill === null ? (
        <EmptyState
          title="No skill yet"
          line="Name what you're mastering, then build it up step by step."
          action={
            <Link className="btn btn-ghost btn-sm" to="/skills">
              Start one
            </Link>
          }
        />
      ) : skill !== null ? (
        <div className="skilltile__body">
          <SkillPyramid
            layerSteps={skill.layerSteps}
            stages={skill.stages}
            size={168}
            label={`${skill.name}: stage ${Math.max(1, skill.layerSteps.length)} of ${skill.stages}`}
          />
          <p className="skilltile__lead">You are on your way to mastering</p>
          <p className="skilltile__name">“{skill.name}”</p>
          <p className="skilltile__meta num">
            Stage {Math.max(1, skill.layerSteps.length)} of {skill.stages} · {plural(skill.steps, 'step')} · {plural(skill.experiences, 'experience')}
          </p>
          <Link className="btn skilltile__enter" to={`/skills?skill=${skill.id}`}>
            Enter skill tracker
          </Link>
        </div>
      ) : (
        <span aria-busy="true" />
      )}
    </Panel>
  );
}
