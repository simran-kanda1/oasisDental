import React from 'react';
import FollowUpOutreachPage from './FollowUpOutreachPage';

/** Legacy route: same hub as Follow up, opened on “Estimates to send”. */
const EstimatesPage: React.FC = () => <FollowUpOutreachPage initialTab="to_send" />;

export default EstimatesPage;
