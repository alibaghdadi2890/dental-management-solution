import { createFileRoute } from '@tanstack/react-router';
import { LabSlipDocument } from '@/features/labs/lab-slip';

export const Route = createFileRoute('/print/lab-slip/$orderId')({
  component: function LabSlipRoute() {
    const { orderId } = Route.useParams();
    return <LabSlipDocument orderId={orderId} />;
  },
});
