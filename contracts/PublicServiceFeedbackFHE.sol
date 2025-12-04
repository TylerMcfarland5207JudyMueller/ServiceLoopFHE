// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PublicServiceFeedbackFHE is SepoliaConfig {
    struct EncryptedFeedback {
        uint256 id;
        address citizen;
        euint32 encryptedServiceType;    // Encrypted service type identifier
        euint32 encryptedRating;         // Encrypted satisfaction rating (1-5)
        euint32 encryptedResponseTime;   // Encrypted response time metric
        euint32 encryptedComment;       // Encrypted comment summary
        uint256 timestamp;
    }
    
    struct ServiceAggregate {
        euint32 encryptedTotalRating;    // Encrypted total rating sum
        euint32 encryptedResponseAvg;     // Encrypted average response time
        euint32 encryptedFeedbackCount;  // Encrypted feedback count
        euint32 encryptedImprovementScore; // Encrypted improvement score
    }
    
    struct DecryptedAggregate {
        uint32 avgRating;
        uint32 avgResponseTime;
        uint32 feedbackCount;
        uint32 improvementScore;
        bool isRevealed;
    }

    uint256 public feedbackCount;
    mapping(uint256 => EncryptedFeedback) public feedbacks;
    mapping(uint32 => ServiceAggregate) public serviceAggregates;
    mapping(uint32 => DecryptedAggregate) public decryptedAggregates;
    
    mapping(address => uint256[]) private citizenFeedbacks;
    mapping(address => bool) private authorizedManagers;
    
    mapping(uint256 => uint256) private requestToFeedbackId;
    mapping(uint256 => uint32) private requestToServiceType;
    
    event FeedbackSubmitted(uint256 indexed id, address indexed citizen);
    event AggregationUpdated(uint32 indexed serviceType);
    event AggregateDecrypted(uint32 indexed serviceType);
    
    address public govAdmin;
    
    modifier onlyAdmin() {
        require(msg.sender == govAdmin, "Not admin");
        _;
    }
    
    modifier onlyManager() {
        require(authorizedManagers[msg.sender], "Not authorized");
        _;
    }
    
    constructor() {
        govAdmin = msg.sender;
    }
    
    /// @notice Authorize a service manager
    function authorizeManager(address manager) public onlyAdmin {
        authorizedManagers[manager] = true;
    }
    
    /// @notice Submit encrypted service feedback
    function submitEncryptedFeedback(
        euint32 encryptedServiceType,
        euint32 encryptedRating,
        euint32 encryptedResponseTime,
        euint32 encryptedComment
    ) public {
        feedbackCount += 1;
        uint256 newId = feedbackCount;
        
        feedbacks[newId] = EncryptedFeedback({
            id: newId,
            citizen: msg.sender,
            encryptedServiceType: encryptedServiceType,
            encryptedRating: encryptedRating,
            encryptedResponseTime: encryptedResponseTime,
            encryptedComment: encryptedComment,
            timestamp: block.timestamp
        });
        
        citizenFeedbacks[msg.sender].push(newId);
        emit FeedbackSubmitted(newId, msg.sender);
    }
    
    /// @notice Update service aggregates
    function updateServiceAggregates(uint256 feedbackId) public {
        EncryptedFeedback storage feedback = feedbacks[feedbackId];
        
        // Get service type (in real implementation, this would be decrypted or handled differently)
        // For simplicity, we assume service type is known from context
        uint32 serviceType = 1; // Placeholder
        
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        
        // Initialize if first feedback
        if (!FHE.isInitialized(aggregate.encryptedFeedbackCount)) {
            aggregate.encryptedTotalRating = FHE.asEuint32(0);
            aggregate.encryptedResponseAvg = FHE.asEuint32(0);
            aggregate.encryptedFeedbackCount = FHE.asEuint32(0);
            aggregate.encryptedImprovementScore = FHE.asEuint32(0);
        }
        
        // Update aggregates
        aggregate.encryptedTotalRating = FHE.add(
            aggregate.encryptedTotalRating,
            feedback.encryptedRating
        );
        
        euint32 newCount = FHE.add(aggregate.encryptedFeedbackCount, FHE.asEuint32(1));
        aggregate.encryptedFeedbackCount = newCount;
        
        // Update average response time
        euint32 totalResponse = FHE.add(
            FHE.mul(aggregate.encryptedResponseAvg, aggregate.encryptedFeedbackCount),
            feedback.encryptedResponseTime
        );
        aggregate.encryptedResponseAvg = FHE.div(totalResponse, newCount);
        
        // Update improvement score
        aggregate.encryptedImprovementScore = calculateImprovementScore(
            feedback.encryptedRating,
            feedback.encryptedResponseTime,
            aggregate.encryptedImprovementScore
        );
        
        emit AggregationUpdated(serviceType);
    }
    
    /// @notice Request decryption of service aggregates
    function requestAggregateDecryption(uint32 serviceType) public onlyManager {
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        require(FHE.isInitialized(aggregate.encryptedFeedbackCount), "No data");
        require(!decryptedAggregates[serviceType].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(aggregate.encryptedTotalRating);
        ciphertexts[1] = FHE.toBytes32(aggregate.encryptedResponseAvg);
        ciphertexts[2] = FHE.toBytes32(aggregate.encryptedFeedbackCount);
        ciphertexts[3] = FHE.toBytes32(aggregate.encryptedImprovementScore);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAggregateData.selector);
        requestToServiceType[reqId] = serviceType;
    }
    
    /// @notice Process decrypted aggregate data
    function decryptAggregateData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint32 serviceType = requestToServiceType[requestId];
        require(serviceType != 0, "Invalid request");
        
        DecryptedAggregate storage dAggregate = decryptedAggregates[serviceType];
        require(!dAggregate.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 totalRating, uint32 avgResponse, uint32 count, uint32 improvementScore) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));
        
        dAggregate.avgRating = totalRating / count;
        dAggregate.avgResponseTime = avgResponse;
        dAggregate.feedbackCount = count;
        dAggregate.improvementScore = improvementScore;
        dAggregate.isRevealed = true;
        
        emit AggregateDecrypted(serviceType);
    }
    
    /// @notice Calculate service improvement score
    function calculateImprovementScore(
        euint32 rating,
        euint32 responseTime,
        euint32 currentScore
    ) private view returns (euint32) {
        // Higher rating and lower response time improve the score
        euint32 ratingImpact = FHE.mul(rating, FHE.asEuint32(20));
        euint32 responseImpact = FHE.sub(
            FHE.asEuint32(100),
            FHE.div(responseTime, FHE.asEuint32(10))
        );
        
        euint32 newContribution = FHE.div(
            FHE.add(ratingImpact, responseImpact),
            FHE.asEuint32(2)
        );
        
        return FHE.div(
            FHE.add(currentScore, newContribution),
            FHE.asEuint32(2)
        );
    }
    
    /// @notice Identify priority areas
    function identifyPriorityAreas() public view returns (euint32) {
        euint32 maxPriority = FHE.asEuint32(0);
        
        // Iterate through service types (simplified)
        for (uint32 i = 1; i <= 5; i++) {
            if (FHE.isInitialized(serviceAggregates[i].encryptedImprovementScore)) {
                euint32 score = serviceAggregates[i].encryptedImprovementScore;
                maxPriority = FHE.max(maxPriority, score);
            }
        }
        
        return maxPriority;
    }
    
    /// @notice Calculate citizen engagement index
    function calculateEngagementIndex(address citizen) public view returns (euint32) {
        uint256[] memory feedbacks = citizenFeedbacks[citizen];
        euint32 engagement = FHE.asEuint32(0);
        
        for (uint i = 0; i < feedbacks.length; i++) {
            EncryptedFeedback storage fb = feedbacks[feedbacks[i]];
            engagement = FHE.add(engagement, fb.encryptedRating);
        }
        
        return FHE.div(
            engagement,
            FHE.asEuint32(uint32(feedbacks.length > 0 ? feedbacks.length : 1))
        );
    }
    
    /// @notice Detect service degradation
    function detectServiceDegradation(uint32 serviceType) public view returns (ebool) {
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        
        // Check if rating dropped below threshold
        euint32 avgRating = FHE.div(
            aggregate.encryptedTotalRating,
            aggregate.encryptedFeedbackCount
        );
        
        return FHE.lt(avgRating, FHE.asEuint32(3)); // Threshold of 3/5
    }
    
    /// @notice Get citizen feedbacks
    function getCitizenFeedbacks(address citizen) public view returns (uint256[] memory) {
        return citizenFeedbacks[citizen];
    }
    
    /// @notice Get encrypted service aggregate
    function getEncryptedAggregate(uint32 serviceType) public view returns (
        euint32 encryptedTotalRating,
        euint32 encryptedResponseAvg,
        euint32 encryptedFeedbackCount,
        euint32 encryptedImprovementScore
    ) {
        ServiceAggregate storage a = serviceAggregates[serviceType];
        return (
            a.encryptedTotalRating,
            a.encryptedResponseAvg,
            a.encryptedFeedbackCount,
            a.encryptedImprovementScore
        );
    }
    
    /// @notice Get decrypted service aggregate
    function getDecryptedAggregate(uint32 serviceType) public view returns (
        uint32 avgRating,
        uint32 avgResponseTime,
        uint32 feedbackCount,
        uint32 improvementScore,
        bool isRevealed
    ) {
        DecryptedAggregate storage a = decryptedAggregates[serviceType];
        return (
            a.avgRating,
            a.avgResponseTime,
            a.feedbackCount,
            a.improvementScore,
            a.isRevealed
        );
    }
    
    /// @notice Calculate service efficiency
    function calculateServiceEfficiency(uint32 serviceType) public view returns (euint32) {
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        
        // Higher rating and lower response time increase efficiency
        euint32 avgRating = FHE.div(
            aggregate.encryptedTotalRating,
            aggregate.encryptedFeedbackCount
        );
        
        return FHE.add(
            FHE.mul(avgRating, FHE.asEuint32(20)), // 20 points per rating point
            FHE.sub(
                FHE.asEuint32(100),
                FHE.div(aggregate.encryptedResponseAvg, FHE.asEuint32(10))
            )
        );
    }
    
    /// @notice Track improvement progress
    function trackImprovementProgress(uint32 serviceType) public view returns (euint32) {
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        
        // Compare current score with historical average
        euint32 baseline = FHE.asEuint32(70); // Baseline score
        return FHE.sub(aggregate.encryptedImprovementScore, baseline);
    }
    
    /// @notice Generate action recommendations
    function generateActionRecommendations(uint32 serviceType) public view returns (euint32) {
        ServiceAggregate storage aggregate = serviceAggregates[serviceType];
        
        euint32 avgRating = FHE.div(
            aggregate.encryptedTotalRating,
            aggregate.encryptedFeedbackCount
        );
        
        // Determine action priority
        return FHE.cmux(
            FHE.lt(avgRating, FHE.asEuint32(3)),
            FHE.asEuint32(1), // High priority
            FHE.cmux(
                FHE.lt(avgRating, FHE.asEuint32(4)),
                FHE.asEuint32(2), // Medium priority
                FHE.asEuint32(3)  // Low priority
            )
        );
    }
    
    /// @notice Measure citizen satisfaction
    function measureCitizenSatisfaction() public view returns (euint32) {
        euint32 totalSatisfaction = FHE.asEuint32(0);
        euint32 totalCount = FHE.asEuint32(0);
        
        // Iterate through service types (simplified)
        for (uint32 i = 1; i <= 5; i++) {
            if (FHE.isInitialized(serviceAggregates[i].encryptedFeedbackCount)) {
                ServiceAggregate storage a = serviceAggregates[i];
                euint32 serviceSatisfaction = FHE.div(
                    a.encryptedTotalRating,
                    a.encryptedFeedbackCount
                );
                
                totalSatisfaction = FHE.add(
                    totalSatisfaction,
                    FHE.mul(serviceSatisfaction, a.encryptedFeedbackCount)
                );
                totalCount = FHE.add(totalCount, a.encryptedFeedbackCount);
            }
        }
        
        return FHE.div(totalSatisfaction, totalCount);
    }
    
    /// @notice Assess feedback credibility
    function assessFeedbackCredibility(address citizen) public view returns (euint32) {
        uint256[] memory feedbacks = citizenFeedbacks[citizen];
        if (feedbacks.length == 0) return FHE.asEuint32(0);
        
        euint32 consistencyScore = FHE.asEuint32(0);
        euint32 prevRating = FHE.asEuint32(0);
        
        for (uint i = 0; i < feedbacks.length; i++) {
            EncryptedFeedback storage fb = feedbacks[feedbacks[i]];
            if (i > 0) {
                euint32 diff = FHE.sub(
                    FHE.max(fb.encryptedRating, prevRating),
                    FHE.min(fb.encryptedRating, prevRating)
                );
                consistencyScore = FHE.add(
                    consistencyScore,
                    FHE.sub(FHE.asEuint32(5), diff) // Higher consistency for smaller differences
                );
            }
            prevRating = fb.encryptedRating;
        }
        
        return FHE.div(
            consistencyScore,
            FHE.asEuint32(uint32(feedbacks.length - 1))
        );
    }
    
    /// @notice Calculate public trust index
    function calculatePublicTrustIndex() public view returns (euint32) {
        euint32 totalTrust = FHE.asEuint32(0);
        uint32 serviceCount = 0;
        
        // Iterate through service types (simplified)
        for (uint32 i = 1; i <= 5; i++) {
            if (FHE.isInitialized(serviceAggregates[i].encryptedImprovementScore)) {
                totalTrust = FHE.add(totalTrust, serviceAggregates[i].encryptedImprovementScore);
                serviceCount++;
            }
        }
        
        return serviceCount > 0 ? FHE.div(totalTrust, FHE.asEuint32(serviceCount)) : FHE.asEuint32(0);
    }
}