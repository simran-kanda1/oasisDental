import React from 'react';
import FollowUpOutreachPage from './FollowUpOutreachPage';

/** Legacy route: estimates hub, opens on pre-d approved / EOB tab. */
const EstimatesPage: React.FC = () => <FollowUpOutreachPage initialTab="pred_approved" />;

export default EstimatesPage;
