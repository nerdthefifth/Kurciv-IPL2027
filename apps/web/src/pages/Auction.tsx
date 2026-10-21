import { useCareer } from '../lib/context';
import { ErrorState, Loading, PageHeader, Empty } from '../components/ui';
import { RetentionCeremony } from './auction/Retention';
import { Lobby } from './auction/Lobby';
import { AcceleratedSelection, LiveRoom } from './auction/Room';
import { AuctionSummary } from './auction/Summary';
import { useAuctionRoom } from './auction/useRoom';

export function AuctionPage() {
  const { overview } = useCareer();
  if (overview.data?.phase === 'retention') return <RetentionCeremony />;
  return <AuctionHouse />;
}

function AuctionHouse() {
  const { room, full, error, busy, command, sim, reload } = useAuctionRoom();
  if (error && !room) return <ErrorState error={new Error(error)} retry={reload} />;
  if (!room) return <Loading label="Opening the auction room…" />;
  const a = room.auction;
  if (!a) {
    return (
      <>
        <PageHeader kicker="The Auction House" title="No auction this window" />
        <Empty title="The room is closed">The next auction opens after next season’s retentions.</Empty>
      </>
    );
  }
  const pending = room.cascade.filter((c: any) => !c.interactive && c.status !== 'complete');
  if (a.status === 'complete' || a.live?.phase === 'COMPLETED') return <AuctionSummary />;
  if (pending.length && !a.live) return <Loading label={`Waiting for ${pending.map((c: any) => c.leagueName).join(', ')}…`} />;
  if (!a.live || a.live.phase === 'PREPARATION') return <Lobby room={room} full={full} busy={busy} command={command} sim={sim} />;
  if (a.live.phase === 'ACCELERATED_SELECTION') return <AcceleratedSelection room={room} busy={busy} command={command} />;
  return (
    <>
      {error && <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm" role="alert">{error} <button className="underline" onClick={reload}>Reconnect</button></p>}
      <LiveRoom room={room} full={full} busy={busy} command={command} sim={sim} />
    </>
  );
}
