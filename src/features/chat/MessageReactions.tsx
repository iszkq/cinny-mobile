import { useMemo } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Toast } from 'antd-mobile';
import { useMatrix } from '../../matrix/MatrixProvider';

export function MessageReactions({ room, event }: { room: Room; event: MatrixEvent }) {
  const { client, session, revision } = useMatrix();
  const groups = useMemo(() => {
    const eventId = event.getId();
    if (!eventId) return [] as [string, Set<MatrixEvent>][];
    return room.relations
      .getChildEventsForEvent(eventId, 'm.annotation', 'm.reaction')
      ?.getSortedAnnotationsByKey() ?? [];
  }, [event, revision, room]);

  const toggle = async (emoji: string, reactions: Set<MatrixEvent>) => {
    if (!client || !event.getId()) return;
    const mine = Array.from(reactions).find((reaction) => reaction.getSender() === session?.userId);
    try {
      if (mine?.getId()) await client.redactEvent(room.roomId, mine.getId()!);
      else await client.sendEvent(room.roomId, 'm.reaction' as any, {
        'm.relates_to': { rel_type: 'm.annotation', event_id: event.getId(), key: emoji },
      });
    } catch {
      Toast.show({ icon: 'fail', content: '更新表情反应失败' });
    }
  };

  if (!groups.length) return null;
  return <div className="reaction-row">{groups.map(([emoji, reactions]) => {
    const reacted = Array.from(reactions).some((reaction) => reaction.getSender() === session?.userId);
    const names = Array.from(reactions).map((reaction) => reaction.sender?.name ?? reaction.getSender()).filter(Boolean).join('、');
    return <button key={emoji} className={reacted ? 'reacted' : ''} type="button" title={names} onClick={() => void toggle(emoji, reactions)}>{emoji} <small>{reactions.size}</small></button>;
  })}</div>;
}
