import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Empty, PageHeader } from '../components/ui';
import { LiveMatch } from './MatchCentre';

export function LabPage() {
  const career = useCareer();
  const lab = useApi<any>(`/careers/${career.id}/lab`, [career.tick]);
  return (
    <Async state={lab}>
      {(d) =>
        d.live ? (
          <LiveMatch slot="lab" initial={d.live} />
        ) : (
          <>
            <PageHeader title="Scenario Lab" />
            <Empty title="No experiment running" action={<Link to={`/c/${career.id}/fixtures`} className="btn-primary mt-2">Pick one of your matches</Link>}>
              Open any of your completed matches and choose “Open in Scenario Lab” to replay it from a chosen delivery with different decisions.
            </Empty>
          </>
        )
      }
    </Async>
  );
}
