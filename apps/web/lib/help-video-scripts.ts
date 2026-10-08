// One source for narration, accessible transcripts, and recording chapter titles.
// All people, answers, and conversations in these recordings are synthetic.
export const helpVideoScripts = {
  quickStart: [
    {
      id: "01-sign-in",
      title: "Sign in and find your workspace",
      narration:
        "Let's make your first Polling Pops Round together. A Round is a set of questions you can run live, without asking participants to create accounts. First, sign in with your email and accept the policies. On a hosted site, open the link in your inbox. This recording uses the local development shortcut, which is not available in production. Once you're in, your workspace keeps everything you create together.",
    },
    {
      id: "02-create",
      title: "Create a blank Round",
      narration:
        "Choose Create, then start blank. You can also use a starter or import existing work, but let's keep this first try simple. Give the Round a name you'll recognize later. We'll use a short safety-training example, and begin with a multiple-choice question. Choose Create Round and write question to open the builder.",
    },
    {
      id: "03-question",
      title: "Write a question and its answers",
      narration:
        "Here, the question map is on the left, your content is in the middle, and settings are on the right. Write a clear prompt, replace the answer labels, and mark the correct response. Our team completed twenty-four of thirty checks, so eighty percent is correct. Add a short explanation for the reveal. Before moving on, wait for Saved. That way, you know the latest changes are stored.",
    },
    {
      id: "04-publish",
      title: "Preview and publish",
      narration:
        "Preview lets you check what participants will see. Read the whole question, try the reveal, and make sure the correct answer and explanation make sense. Return to the editor, then publish. Publishing freezes a reviewed version for delivery; it doesn't start a live session. You can keep editing the draft later without changing a Round that's already running.",
    },
    {
      id: "05-host",
      title: "Open a lobby and share the QR code",
      narration:
        "Now open the live setup for your published Round. Check the audience limit, scoring, and results visibility, then create the live session. The lobby gives you a seven-digit code, a direct join link, and a QR code. Share the link or show the QR on a screen. For phone testing, the join address must be reachable from the phone. Localhost only points back to that device. The code in this video is only a demo; use the code from your own lobby.",
    },
    {
      id: "06-join",
      title: "Join as a participant",
      narration:
        "Let's switch to a participant. Open the shared link, scan the QR, or enter the code on the join page. With these education settings, Polling Pops gives us a friendly session alias. We choose an avatar and join. No participant sign-in is needed. The lobby waits for the facilitator, so everyone can get connected before the first question opens.",
    },
    {
      id: "07-answer",
      title: "Start, answer, and reveal",
      narration:
        "The facilitator starts the Round. Participants see the complete question and answer labels on their own devices. Choose a response and submit it. Look for Answer received and saved, rather than assuming a tap was enough. Back on the host screen, lock the responses, then reveal. That separates collecting answers from discussing them, and gives you a clean moment to explain the result.",
    },
    {
      id: "08-results",
      title: "Review results and try it yourself",
      narration:
        "Finish the Round and open its report. You can review participation and question results, then come back through Results later. Our quick test had just one participant, so it isn't meaningful evidence about a whole group. Your turn: create one question, join from a second browser or phone, and complete a Round. For the recovery workflow and room conversation tools, continue with the user guide.",
    },
  ],
  userGuide: [
    {
      id: "01-themes",
      title: "Choose an experience for your audience",
      narration:
        "Welcome back. Let's go beyond a quiz and use Polling Pops to notice confusion, support the room, and check again. Start with an experience that suits the topic. The category recommends a preset, and you can choose one explicitly. Campus fits education; Blueprint suits technical material; Pops keeps things playful. These change the presentation, not scoring or timers. The host can override the experience for one session, and participants keep their own accessibility preferences.",
    },
    {
      id: "02-diagnose",
      title: "Add confidence and concept information",
      narration:
        "In Diagnose, choose whether confidence is off, optional, or required. Required confidence helps distinguish a guess from a confident misconception. Add a concept key so the report can group the evidence. You can also label a misleading answer and explain why someone might choose it. Those notes are for the facilitator. They aren't shown to participants while the question is open. Keep the labels specific, useful, and free of personal judgments.",
    },
    {
      id: "03-recheck",
      title: "Prepare a linked recheck",
      narration:
        "Next, use Recover to add a linked recheck. Ask about the same concept in a fresh situation. Here, we change twenty-four of thirty checks to forty of fifty. The correct method stays the same, but the learner has to apply it again. Mark the answer and add an explanation. A linked recheck gives stronger session evidence than simply asking the original question twice. Preview both questions, wait for Saved, and publish the reviewed set.",
    },
    {
      id: "04-presentations",
      title: "Combine context slides with questions",
      narration:
        "If you need context before the questions, create a Presentation. Content slides and interactive questions live in one sequence. Here we're adding a short briefing and an audience question, then checking the preview. This is a responsive facilitation tool, not a pixel-perfect replacement for a slide-design application. Use a Round for a focused check; use a Presentation when explanations and questions need to travel together.",
    },
    {
      id: "05-pulse",
      title: "Read Audience Pulse without judging people",
      narration:
        "In a live lobby or question, participants can say Got it, I'm unsure, Show an example, or Too fast. Let's request an example. The Audience panel lets the facilitator see the session alias and current signal. Public views show totals only, and distributions stay hidden until at least five people signal in that context. Signals don't change scores or automatically diagnose anyone. They're an invitation to pause, check access, or offer support.",
    },
    {
      id: "06-conversation",
      title: "Enable chat and moderate Q and A",
      narration:
        "Chat starts off. Enable it when a room conversation will help, and keep the slow mode appropriate for your audience. A participant can send a short message; the facilitator can pin it, and people can react. Q and A is separate: it keeps questions and facilitator replies together. With education premoderation, the question waits for review before appearing publicly. Publish and answer it when appropriate. Moderation controls help you remove messages or restrict someone who disrupts the session.",
    },
    {
      id: "07-recovery",
      title: "Explain, then verify with a recheck",
      narration:
        "Now start the diagnostic question. In this synthetic group, all five people choose the wrong answer with high confidence. Lock and reveal the responses. The insight explains the measurement behind its suggestion; it is guidance, not an automated judgment. Choose an explanation, work through the method with the group, and finish the intervention. Then open the linked recheck. Four of our five demo participants now apply the method correctly. Complete the branch before moving on.",
    },
    {
      id: "08-evidence",
      title: "Interpret recovery evidence honestly",
      narration:
        "The report connects the first responses, the intervention, and the linked recheck. Here, four of five initially incorrect participants recovered on the new question. Read the numerator and denominator, not just the percentage. It's a small sample, and it shows recovery during this session, not proof of long-term learning. Review the unresolved concept and interaction summary, and use them to decide what deserves another explanation or follow-up.",
    },
    {
      id: "09-practice",
      title: "Share practice and return to your work",
      narration:
        "For another opportunity to practise, open the Round's assignment settings and create an account-free practice link. Set the access and completion options for your audience before sharing it. Participants work through the questions without becoming workspace members. Later, return through Library, Sessions, Assignments, or Results to manage what you've created. Features depend on your deployment and permissions. Start with one concept, try the full recovery loop, and use the evidence to improve your next session.",
    },
  ],
} as const;

export type HelpVideoKey = keyof typeof helpVideoScripts;
