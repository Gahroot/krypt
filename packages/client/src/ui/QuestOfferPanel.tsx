import { Coins, Gift, Square, Star } from "lucide-react";
import { getItemDef } from "@maple/shared";

import { Panel } from "@/ui/components/Panel";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Separator } from "@/ui/components/ui/separator";
import { useUIStore, type QuestRewardSnapshot } from "@/ui/store";

/**
 * QuestOfferPanel — the quest offer (accept/decline) and quest turn-in
 * (rewards display) overlays.
 *
 * React migration of the legacy hand-drawn Phaser panels (UI.ts
 * buildQuestOfferPanel / buildQuestTurninPanel). Reads its snapshots + action
 * registry from the bridge store and renders from the shared kit (Panel /
 * Button / Badge / Separator). Accept/decline + turn-in/dismiss flow through
 * `questActions.*`, wired by `UIScene` to the authoritative QUEST_ACCEPT /
 * QUEST_DECLINE / QUEST_TURNIN_ACCEPT / QUEST_TURNIN_DECLINE messages.
 */

const CENTER = "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";

/** Reward preview rows shared by both overlays. */
function RewardList({ rewards }: { rewards: QuestRewardSnapshot }) {
  return (
    <div className="flex flex-col gap-1.5 pl-1">
      {rewards.mesos ? (
        <div className="flex items-center gap-2 text-[12px] text-amber-200">
          <Coins className="size-3.5" />
          {rewards.mesos.toLocaleString()} Mesos
        </div>
      ) : null}
      {rewards.exp ? (
        <div className="flex items-center gap-2 text-[12px] text-emerald-300">
          <Star className="size-3.5" />
          {rewards.exp.toLocaleString()} EXP
        </div>
      ) : null}
      {(rewards.items ?? []).map((itemId) => (
        <div key={itemId} className="flex items-center gap-2 text-[12px] text-foreground">
          <Gift className="size-3.5 text-sky-300" />
          {getItemDef(itemId)?.name ?? itemId}
        </div>
      ))}
    </div>
  );
}

function QuestOffer() {
  const offer = useUIStore((s) => s.questOffer);
  const actions = useUIStore((s) => s.questActions);

  if (!offer) return null;

  return (
    <Panel
      title="📋 Quest Offer"
      onClose={() => actions?.declineOffer(offer.questId)}
      className={`${CENTER} w-[380px]`}
    >
      <h3 className="text-[14px] font-bold text-foreground">{offer.questName}</h3>
      {offer.requiredLevel !== undefined && (
        <Badge variant="outline" className="mt-1.5 text-muted-foreground">
          Requires Level {offer.requiredLevel}
        </Badge>
      )}

      <Separator className="my-3" />

      <p className="text-[12px] font-bold text-emerald-300">Objectives</p>
      <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
        {offer.objectives.map((obj, i) => (
          <div
            key={`${obj.kind}-${i}`}
            className="flex items-start gap-2 text-[12px] text-muted-foreground"
          >
            <Square className="mt-0.5 size-3 shrink-0" />
            <span>{obj.description}</span>
          </div>
        ))}
      </div>

      <Separator className="my-3" />

      <p className="text-[12px] font-bold text-amber-200">Rewards</p>
      <div className="mt-1.5">
        <RewardList rewards={offer.rewards} />
      </div>

      <div className="mt-4 flex justify-center gap-3">
        <Button onClick={() => actions?.acceptOffer(offer.questId)}>Accept</Button>
        <Button variant="secondary" onClick={() => actions?.declineOffer(offer.questId)}>
          Decline
        </Button>
      </div>
    </Panel>
  );
}

function QuestTurnin() {
  const turnin = useUIStore((s) => s.questTurnin);
  const actions = useUIStore((s) => s.questActions);

  if (!turnin) return null;

  return (
    <Panel
      title="✅ Quest Complete!"
      onClose={() => actions?.declineTurnin(turnin.questId)}
      className={`${CENTER} w-[360px]`}
    >
      <h3 className="text-[14px] font-bold text-foreground">{turnin.questName}</h3>

      <Separator className="my-3" />

      <p className="text-[12px] font-bold text-amber-200">Turn in for:</p>
      <div className="mt-1.5">
        <RewardList rewards={turnin.rewards} />
      </div>

      <div className="mt-4 flex justify-center gap-3">
        <Button onClick={() => actions?.acceptTurnin(turnin.questId)}>Turn In</Button>
        <Button variant="secondary" onClick={() => actions?.declineTurnin(turnin.questId)}>
          Not yet
        </Button>
      </div>
    </Panel>
  );
}

export function QuestOfferPanel() {
  return (
    <>
      <QuestOffer />
      <QuestTurnin />
    </>
  );
}
