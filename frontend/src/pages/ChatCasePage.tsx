import KYCChatIntake from '../components/chat/KYCChatIntake'

/**
 * ChatCasePage
 * Wraps KYCChatIntake inside the Layout shell.
 *
 * onCaseCreated is intentionally a no-op here — we do NOT auto-navigate
 * away because that wipes the chat history. The officer uses the
 * "Open case →" button inside the launched card to view the case.
 */
export default function ChatCasePage() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <KYCChatIntake
        onCaseCreated={() => {
          // Intentionally empty — navigation is handled by the "Open case →"
          // button inside the LaunchedCard in the chat. Auto-navigating here
          // would wipe the conversation.
        }}
      />
    </div>
  )
}
